import { resolveOps, type ResolveMaps } from '@/lib/domain/import/finmap/resolve'
import { normKey } from '@/lib/domain/import/finmap/fold'
import { CHECK_LIMIT, type BatchOp, type FinmapCheckOp, type FinmapSetupAccount, type FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import type { FinmapExisting, FinmapPlan } from '@/lib/domain/import/finmap/types'
import { FINMAP_BATCH_OPS } from '@/lib/domain/import/finmap/types'
import { notifyLedgerChanged } from './ledger-events'
import { LedgerApiError, readApiError } from './ledger-client'

/** The refusals the screen samples (lines and reasons only: never names or amounts). */
const SAMPLE_MAX = 20

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/imports/finmap`

export interface FinmapEntityCounts {
  accounts: number
  categories: number
  counterparties: number
  tags: number
}

/** The set-up response: the ids by name (the same maps the resolver takes), the import and what this run created. */
export interface FinmapSetupResponse extends ResolveMaps {
  importId: string
  created: FinmapEntityCounts
}

export interface FinmapCheckResponse {
  /** One per checked operation, in request order. */
  seen: boolean[]
}

export interface FinmapBatchResponse {
  created: number
  skipped: number
  /** `index` is the position in the batch request. */
  refused: Array<{ index: number; reason: string; field?: string }>
}

export interface FinmapFinishResponse {
  fitted: Array<{ accountId: string; openingMinor: number }>
  differences: Array<{ accountId: string; differenceMinor: number }>
}

async function post<T>(orgId: string, step: 'check' | 'setup' | 'batch' | 'finish', body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base(orgId)}/${step}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

/** Which of these operations were already written by a Finmap import (read-only, up to CHECK_LIMIT). */
export const finmapCheck = (orgId: string, operations: FinmapCheckOp[], signal?: AbortSignal) =>
  post<FinmapCheckResponse>(orgId, 'check', { operations }, signal)

/** Creates the entities the file needs that FinFlow does not have (matched by name) and opens the import (or continues one). */
export const finmapSetup = (orgId: string, body: FinmapSetupRequest, signal?: AbortSignal) => post<FinmapSetupResponse>(orgId, 'setup', body, signal)

/** Writes one batch of at most FINMAP_BATCH_OPS operations under the import. */
export const finmapBatch = (orgId: string, importId: string, operations: BatchOp[], signal?: AbortSignal) =>
  post<FinmapBatchResponse>(orgId, 'batch', { importId, operations }, signal)

/** Fits the opening balances of the new accounts; the import is complete after this. */
export const finmapFinish = (orgId: string, importId: string, signal?: AbortSignal) => post<FinmapFinishResponse>(orgId, 'finish', { importId }, signal)

export interface FinmapRefusedSample {
  line: number
  reason: string
}

export interface FinmapResult {
  /** Null only when the set-up step did not run (busy, or it failed before an import existed). */
  importId: string | null
  created: number
  /** Operations already written by an earlier run: found by the check, or refused by the batch as duplicates. */
  skipped: number
  refused: { total: number; byReason: Record<string, number>; sample: FinmapRefusedSample[] }
  /** Accounts whose opening balance the finish step fitted. */
  fitted: number
  differences: FinmapFinishResponse['differences']
  entities: FinmapEntityCounts
  /** Tags left off their operations (more than ten on one operation); the first ten in sheet order are kept. */
  tagsDropped: number
  /** Another request is writing the same import or account: stopped, call again with `importId`. */
  busy?: true
  /** The run stopped with this code: a ledger code (`ledger_busy`, `conflict`), `network`, or `aborted`. */
  error?: string
}

export interface FinmapRunArgs {
  fileName: string
  plan: FinmapPlan
  /** The accounts the file needs that FinFlow does not have yet. */
  accounts: FinmapSetupAccount[]
  existing: FinmapExisting
  /** An applied Finmap import to continue (a retry of a run that stopped). */
  importId?: string
  /** Operations processed so far (created, skipped or refused) over all operations of the plan. */
  onProgress: (done: number, total: number) => void
  signal?: AbortSignal
}

const ZERO_ENTITIES: FinmapEntityCounts = { accounts: 0, categories: 0, counterparties: 0, tags: 0 }

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The import was aborted', 'AbortError')
}

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'AbortError'

/** A conflict (a concurrent write changed a document the batch read) or a failed request: the same batch can be sent again. */
const retryable = (e: unknown): boolean => (e instanceof LedgerApiError && e.code === 'conflict') || e instanceof TypeError

/** Sends one batch; a conflict or a network error gets one more try (the batch is idempotent: its marks skip what was written). */
async function sendBatch(orgId: string, importId: string, ops: BatchOp[], signal: AbortSignal | undefined): Promise<FinmapBatchResponse> {
  try {
    return await finmapBatch(orgId, importId, ops, signal)
  } catch (e) {
    if (!retryable(e)) throw e
    throwIfAborted(signal)
    return finmapBatch(orgId, importId, ops, signal)
  }
}

/** Records why the run stopped: busy, an API code, a network failure or an abort. Anything else is a bug and is thrown. */
function stopped(result: FinmapResult, e: unknown): void {
  if (e instanceof LedgerApiError) {
    if (e.code === 'already_running') result.busy = true
    else result.error = e.code
    return
  }
  if (isAbort(e)) {
    result.error = 'aborted'
    return
  }
  if (e instanceof TypeError) {
    result.error = 'network'
    return
  }
  throw e
}

/**
 * Imports a Finmap plan (S14b): set-up, id resolution, the duplicate check (only operations whose accounts existed before), the
 * batches of the operations not yet written, then the finish that fits the new accounts' balances. A run that stops (busy,
 * an error, an abort) does not finish; its importId lets the same file continue. The ledger is told once at the end.
 */
export async function runFinmapImport(orgId: string, args: FinmapRunArgs): Promise<FinmapResult> {
  const { plan, signal, onProgress } = args
  const total = plan.operations.length
  const result: FinmapResult = {
    importId: args.importId ?? null,
    created: 0,
    skipped: 0,
    refused: { total: 0, byReason: {}, sample: [] },
    fitted: 0,
    differences: [],
    entities: { ...ZERO_ENTITIES },
    tagsDropped: 0,
  }
  let done = 0
  try {
    throwIfAborted(signal)
    const setup = await finmapSetup(orgId, {
      ...(args.importId === undefined ? {} : { importId: args.importId }),
      fileName: args.fileName,
      accounts: args.accounts,
      categories: plan.create.categories,
      counterparties: plan.create.counterparties,
      tags: plan.create.tags,
    }, signal)
    result.importId = setup.importId
    result.entities = setup.created

    const resolved = resolveOps(plan.operations, setup, args.existing)
    result.tagsDropped = resolved.tagsDropped
    const ops = resolved.ops
    const importId = setup.importId

    // An operation on an account the run creates cannot be written yet, so it cannot be a duplicate: it is not checked.
    const newAccounts = new Set(args.accounts.map((a) => normKey(a.name)))
    const checkable = ops.map((_, i) => i).filter((i) => {
      const op = plan.operations[i]
      return !newAccounts.has(normKey(op.account)) && (op.toAccount === null || !newAccounts.has(normKey(op.toAccount)))
    })
    const seen = new Array<boolean>(ops.length).fill(false)
    for (const chunk of chunksOf(checkable, CHECK_LIMIT)) {
      throwIfAborted(signal)
      const r = await finmapCheck(orgId, chunk.map((i) => ({ accountId: ops[i].accountId, toAccountId: ops[i].toAccountId, identity: ops[i].identity, ordinal: ops[i].ordinal })), signal)
      chunk.forEach((i, j) => {
        if (r.seen[j]) seen[i] = true
      })
    }
    const seenCount = seen.filter(Boolean).length
    result.skipped += seenCount
    done += seenCount
    if (seenCount > 0) onProgress(done, total)

    const toSend = ops.map((_, i) => i).filter((i) => !seen[i])
    for (const chunk of chunksOf(toSend, FINMAP_BATCH_OPS)) {
      throwIfAborted(signal)
      const batch = await sendBatch(orgId, importId, chunk.map((i) => ops[i]), signal)
      result.created += batch.created
      result.skipped += batch.skipped
      for (const refusal of batch.refused) {
        result.refused.total++
        result.refused.byReason[refusal.reason] = (result.refused.byReason[refusal.reason] ?? 0) + 1
        if (result.refused.sample.length < SAMPLE_MAX) {
          result.refused.sample.push({ line: plan.operations[chunk[refusal.index]].lines[0], reason: refusal.reason })
        }
      }
      done += batch.created + batch.skipped + batch.refused.length
      onProgress(done, total)
    }

    throwIfAborted(signal)
    const finished = await finmapFinish(orgId, importId, signal)
    result.fitted = finished.fitted.length
    result.differences = finished.differences
  } catch (e) {
    stopped(result, e)
  } finally {
    notifyLedgerChanged()
  }
  return result
}
