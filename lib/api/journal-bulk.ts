import { MAX_BULK_IDS, type BulkOutcome, type BulkRequest } from '@/lib/domain/journal/bulk-input'
import { apiCall } from './ledger-client'
import { notifyLedgerChanged } from './ledger-events'

/** Sends one chunk (at most 25 ids) to the bulk endpoint. */
export async function postBulk(orgId: string, request: BulkRequest): Promise<BulkOutcome[]> {
  const out = (await apiCall('POST', `/api/orgs/${encodeURIComponent(orgId)}/transactions/bulk`, request)) as { results: BulkOutcome[] }
  return out.results
}

export interface ChunkedResult {
  outcomes: BulkOutcome[]
  /** True when the person stopped it: what was done stays done. */
  stopped: boolean
}

/**
 * Runs `send` over the ids in chunks, one after another; the signal is checked between chunks. A chunk whose request
 * throws ends the run (`stopped`) with the earlier outcomes and that chunk's ids as `unknown`; it never throws.
 */
export async function runChunked(
  ids: string[],
  send: (chunk: string[]) => Promise<BulkOutcome[]>,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChunkedResult> {
  const outcomes: BulkOutcome[] = []
  for (let i = 0; i < ids.length; i += MAX_BULK_IDS) {
    if (opts.signal?.aborted) return { outcomes, stopped: true }
    const chunk = ids.slice(i, i + MAX_BULK_IDS)
    try {
      outcomes.push(...(await send(chunk)))
    } catch {
      // The request failed (network, a 5xx): what the earlier chunks did stays reported, this chunk's rows are unknown
      // (the server may or may not have applied them) and nothing further is sent.
      outcomes.push(...chunk.map((id): BulkOutcome => ({ id, ok: false, code: 'unknown' })))
      opts.onProgress?.(Math.min(i + MAX_BULK_IDS, ids.length), ids.length)
      return { outcomes, stopped: true }
    }
    opts.onProgress?.(Math.min(i + MAX_BULK_IDS, ids.length), ids.length)
    if (opts.signal?.aborted && i + MAX_BULK_IDS < ids.length) return { outcomes, stopped: true }
  }
  return { outcomes, stopped: false }
}

/** Applies a bulk request to many ids, then tells the journal once that operations changed. */
export async function applyBulk(
  orgId: string,
  action: 'update' | 'delete',
  ids: string[],
  patch: Extract<BulkRequest, { action: 'update' }>['patch'] | undefined,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChunkedResult> {
  try {
    return await runChunked(
      ids,
      (chunk) => postBulk(orgId, action === 'delete' ? { action, ids: chunk } : { action, ids: chunk, patch: patch as NonNullable<typeof patch> }),
      opts,
    )
  } finally {
    notifyLedgerChanged()
  }
}
