import { exportReadme } from '@/content/legal/export-readme'
import { EXPORT_COLLECTIONS, type ExportCollection } from '@/lib/domain/export/collections'
import { buildExportZip } from '@/lib/domain/export/zip'
import { exportZipFileName } from '@/lib/utils/download'
import { todayDay } from '@/lib/utils/today'
import { readApiError } from './ledger-client'

export interface ExportProgress {
  collection: ExportCollection
  /** 1-based position of `collection` in the export order. */
  index: number
  total: number
  /** Documents read so far, over all collections (this page included). */
  docs: number
}

export interface ExportResult {
  blob: Blob
  fileName: string
  counts: Record<ExportCollection, number>
  /** False when the audit entry could not be written; the file is complete all the same. */
  auditRecorded: boolean
}

interface ExportPageBody {
  docs: Array<{ id: string; data: Record<string, unknown> }>
  next: string | null
}

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/export/data`

const abortError = () => new DOMException('Aborted', 'AbortError')
const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw abortError()
}

/** One request; a network error (fetch's TypeError) gets one more try, a refusal (HTTP error) does not. */
async function getJson<T>(url: string, signal: AbortSignal | undefined): Promise<T> {
  const send = () => fetch(url, { credentials: 'same-origin', signal })
  let res: Response
  try {
    res = await send()
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    throwIfAborted(signal)
    res = await send()
  }
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

/**
 * Reads every export collection page by page and builds the ZIP in the browser. All documents are kept in memory (a company of
 * about 40k operations is tens of MB): that is the accepted bound for this version. A page may come back empty with a next
 * cursor (every document in it was skipped), so paging goes on until `next` is null. Throws `LedgerApiError` for a server
 * refusal, a TypeError for a network failure that outlasted the retry, and an AbortError when `signal` aborts.
 */
export async function runExport(
  orgId: string,
  orgName: string,
  opts: { onProgress?: (p: ExportProgress) => void; signal?: AbortSignal } = {},
): Promise<ExportResult> {
  const { onProgress, signal } = opts
  const counts = Object.fromEntries(EXPORT_COLLECTIONS.map((c) => [c, 0])) as Record<ExportCollection, number>
  const files: Record<string, string> = {}
  let total = 0

  for (const [i, collection] of EXPORT_COLLECTIONS.entries()) {
    const docs: ExportPageBody['docs'] = []
    let after: string | null = null
    do {
      throwIfAborted(signal)
      const query: string = `collection=${collection}${after === null ? '' : `&after=${encodeURIComponent(after)}`}`
      const page: ExportPageBody = await getJson<ExportPageBody>(`${base(orgId)}?${query}`, signal)
      docs.push(...page.docs)
      total += page.docs.length
      after = page.next
      onProgress?.({ collection, index: i + 1, total: EXPORT_COLLECTIONS.length, docs: total })
    } while (after !== null)
    counts[collection] = docs.length
    files[`${collection}.json`] = JSON.stringify(
      docs.map((d) => ({ id: d.id, ...d.data })),
      null,
      2,
    )
  }

  throwIfAborted(signal)
  files['me.json'] = JSON.stringify(await getJson<unknown>('/api/me/export', signal), null, 2)

  const day = todayDay()
  files['README.txt'] = exportReadme(orgName, day)
  throwIfAborted(signal)
  const blob = new Blob([buildExportZip(files) as BlobPart], { type: 'application/zip' })

  let auditRecorded = true
  try {
    const res = await fetch(base(orgId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counts }),
    })
    auditRecorded = res.ok
  } catch {
    auditRecorded = false
  }
  return { blob, fileName: exportZipFileName(orgName, day), counts, auditRecorded }
}
