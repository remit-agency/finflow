import { alternativeIndices } from '@/lib/domain/import/finmap/alternatives'
import { resolveOps, type ResolveMaps } from '@/lib/domain/import/finmap/resolve'
import { normKey } from '@/lib/domain/import/finmap/fold'
import { CHECK_LIMIT, type BatchOp, type FinmapCheckOp, type FinmapSetupAccount, type FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import type { FinmapExisting, FinmapPlan, PlannedOp } from '@/lib/domain/import/finmap/types'
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
  /** The accounts this run created, with their ids and names (the differences name them). */
  createdAccounts: Array<{ id: string; name: string; currency: string }>
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
  /**
   * The same rows planned with the pairing flipped (`planFinmap` with `pairTransfers` inverted). An operation whose other shape an
   * earlier import wrote is skipped, so a file imported with pairing on is not imported again with it off, or the reverse.
   */
  alternative: PlannedOp[]
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

/** A check request carries at most this much JSON (the route refuses 256 KB; the envelope is small). */
const CHECK_BUDGET_BYTES = 180 * 1024
/** A batch request carries at most this much JSON (the route refuses 256 KB). */
const BATCH_BUDGET_BYTES = 200 * 1024

/** The UTF-8 length of a string: what a request body's Content-Length counts (a Cyrillic letter is 2 bytes, an emoji 4). */
function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** The bytes one item adds to a JSON array: its JSON and the comma that follows it. */
const jsonBytes = (item: unknown): number => utf8Length(JSON.stringify(item)) + 1

/**
 * Splits `indices` into consecutive chunks of at most `maxCount` items whose JSON, as `bytesOf` measures it, stays within
 * `maxBytes`. An item that is over the budget by itself is sent alone: the route then answers for it, which is the honest answer.
 */
function chunkBySize(indices: readonly number[], maxCount: number, maxBytes: number, bytesOf: (i: number) => number): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  let bytes = 0
  for (const i of indices) {
    const b = bytesOf(i)
    if (cur.length > 0 && (cur.length === maxCount || bytes + b > maxBytes)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(i)
    bytes += b
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The import was aborted', 'AbortError')
}

/**
 * Which of these keys an earlier import wrote: requests of at most CHECK_LIMIT keys within the byte budget, in order. Shared by the
 * run and by the preview count (`countAlreadyImported`), so both chunk the same way.
 */
async function seenFlags(orgId: string, keys: FinmapCheckOp[], signal: AbortSignal | undefined, onProgress?: (done: number, total: number) => void): Promise<boolean[]> {
  const seen = new Array<boolean>(keys.length).fill(false)
  let done = 0
  for (const chunk of chunkBySize(
    keys.map((_, i) => i),
    CHECK_LIMIT,
    CHECK_BUDGET_BYTES,
    (i) => jsonBytes(keys[i]),
  )) {
    throwIfAborted(signal)
    const r = await finmapCheck(orgId, chunk.map((i) => keys[i]), signal)
    chunk.forEach((i, j) => {
      if (r.seen[j]) seen[i] = true
    })
    done += chunk.length
    onProgress?.(done, keys.length)
  }
  return seen
}

/** The check key of a planned operation, or null when one of its accounts has no id here (a new account: it cannot hold a duplicate). */
function checkKeyOf(op: PlannedOp, accountIdOf: (name: string) => string | undefined): FinmapCheckOp | null {
  const accountId = accountIdOf(op.account)
  if (accountId === undefined) return null
  const toAccountId = op.toAccount === null ? null : accountIdOf(op.toAccount)
  if (toAccountId === undefined) return null
  return { accountId, toAccountId, identity: op.identity, ordinal: op.ordinal }
}

/** The ids of the accounts FinFlow has, by `normKey` of the name (the first of each name). */
function existingAccountIdOf(existing: FinmapExisting): (name: string) => string | undefined {
  const ids = new Map<string, string>()
  for (const a of existing.accounts) if (!ids.has(normKey(a.name))) ids.set(normKey(a.name), a.id)
  return (name) => ids.get(normKey(name))
}

/**
 * Which of the planned operations an earlier Finmap import already wrote: by their own key, or by the key of the other shape of their
 * rows (`alternative`: the same rows planned with the pairing flipped, see `alternativeIndices`). An operation is skipped when any of
 * its alternatives was written. Requests of at most CHECK_LIMIT keys, in one stream: the own keys first, then the alternatives that
 * matter. `accountIdOf` gives null for an account with no id here, which is never checked.
 */
async function alreadyWritten(
  orgId: string,
  ops: readonly PlannedOp[],
  alternative: readonly PlannedOp[],
  accountIdOf: (name: string) => string | undefined,
  signal: AbortSignal | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<boolean[]> {
  const alternativesOf = alternativeIndices(ops, alternative)
  const keys: FinmapCheckOp[] = []
  const ownAt: number[] = []
  ops.forEach((op, i) => {
    const key = checkKeyOf(op, accountIdOf)
    if (key !== null) {
      keys.push(key)
      ownAt.push(i)
    }
  })
  const needed = new Set<number>()
  for (const list of alternativesOf) for (const j of list) needed.add(j)
  const altAt: number[] = []
  for (const j of [...needed].sort((a, b) => a - b)) {
    const key = checkKeyOf(alternative[j], accountIdOf)
    if (key !== null) {
      keys.push(key)
      altAt.push(j)
    }
  }
  const flags = await seenFlags(orgId, keys, signal, onProgress)
  const seen = new Array<boolean>(ops.length).fill(false)
  ownAt.forEach((i, k) => {
    if (flags[k]) seen[i] = true
  })
  const altSeen = new Set<number>()
  altAt.forEach((j, k) => {
    if (flags[ownAt.length + k]) altSeen.add(j)
  })
  alternativesOf.forEach((list, i) => {
    if (list.some((j) => altSeen.has(j))) seen[i] = true
  })
  return seen
}

/**
 * How many operations of `plan` an earlier Finmap import already wrote (the preview's «already imported»), counting the other shape
 * of their rows too (`alternative`). Read-only.
 */
export async function countAlreadyImported(
  orgId: string,
  plan: FinmapPlan,
  existing: FinmapExisting,
  args: { alternative: PlannedOp[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<number> {
  const seen = await alreadyWritten(orgId, plan.operations, args.alternative, existingAccountIdOf(existing), args.signal, args.onProgress)
  return seen.filter(Boolean).length
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
    createdAccounts: [],
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
    result.createdAccounts = args.accounts.flatMap((a) => {
      const id = setup.accounts[normKey(a.name)]
      return id === undefined ? [] : [{ id, name: a.name, currency: a.currency }]
    })

    const resolved = resolveOps(plan.operations, setup, args.existing)
    result.tagsDropped = resolved.tagsDropped
    const ops = resolved.ops
    const importId = setup.importId

    // An account the run creates cannot be written yet, so an operation on it cannot be a duplicate: it is not checked. The accounts
    // FinFlow has are the ones the plan does not create (the set-up creates only the new ones).
    const newAccounts = new Set(args.accounts.map((a) => normKey(a.name)))
    const existingIds = existingAccountIdOf(args.existing)
    const seen = await alreadyWritten(orgId, plan.operations, args.alternative, (name) => (newAccounts.has(normKey(name)) ? undefined : existingIds(name)), signal)
    const seenCount = seen.filter(Boolean).length
    result.skipped += seenCount
    done += seenCount
    if (seenCount > 0) onProgress(done, total)

    const toSend = ops.map((_, i) => i).filter((i) => !seen[i])
    for (const chunk of chunkBySize(toSend, FINMAP_BATCH_OPS, BATCH_BUDGET_BYTES, (i) => jsonBytes(ops[i]))) {
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
