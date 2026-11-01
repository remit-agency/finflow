import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { MAX_CONVERT_IDS, type MadeOutcome, type SuggestionsResult, type TransferOutcome, type TransferSuggestion } from '@/lib/domain/transfers/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { apiCall, readApiError } from './ledger-client'
import { notifyLedgerChanged, withoutNotifications } from './ledger-events'
import { revertTransaction } from './transaction-undo'

const EVENT = 'finflow:transfers-changed'
const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

/** Tells the journal's suggestions that transfers were made or split in this browser: they read again. */
export function notifyTransfersChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onTransfersChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

/** After a write: the journal reloads its rows and the suggestions read again. */
function changed(): void {
  notifyLedgerChanged()
  notifyTransfersChanged()
}

/** The pairs the journal suggests (S10b). Throws `LedgerApiError`. */
export async function fetchTransferSuggestions(orgId: string, signal?: AbortSignal): Promise<SuggestionsResult> {
  const res = await fetch(`${org(orgId)}/transfers/suggestions`, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as SuggestionsResult
}

async function post(orgId: string, body: unknown): Promise<TransferOutcome[]> {
  const out = (await apiCall('POST', `${org(orgId)}/transfers`, body)) as { results: TransferOutcome[] }
  return out.results
}

/** Confirms suggested pairs with the versions the person saw: a pair changed since is a `conflict`, never merged blindly. */
export async function confirmPairs(orgId: string, pairs: readonly TransferSuggestion[]): Promise<TransferOutcome[]> {
  try {
    return await post(orgId, { pairs: pairs.map((p) => ({ fromId: p.from.id, toId: p.to.id, versions: [p.from.version, p.to.version] })) })
  } finally {
    changed()
  }
}

/** «Об’єднати в переказ»: two selected bank operations, in any order. */
export async function mergeIntoTransfer(orgId: string, ids: readonly [string, string]): Promise<TransferOutcome> {
  try {
    const [result] = await post(orgId, { merge: [...ids] })
    return result
  } finally {
    changed()
  }
}

/**
 * «Зробити переказом»: operations of one bank account with `toAccountId`, in requests of MAX_CONVERT_IDS. A request that
 * fails (network, a 5xx) ends the run: its ids and those not sent yet are `unknown`, what was done stays reported.
 */
export async function convertToTransfers(orgId: string, ids: readonly string[], toAccountId: string): Promise<TransferOutcome[]> {
  const out: TransferOutcome[] = []
  try {
    for (let i = 0; i < ids.length; i += MAX_CONVERT_IDS) {
      try {
        out.push(...(await post(orgId, { convert: { ids: ids.slice(i, i + MAX_CONVERT_IDS), toAccountId } })))
      } catch {
        out.push(...ids.slice(i).map((id): TransferOutcome => ({ ids: [id], ok: false, code: 'unknown' })))
        break
      }
    }
    return out
  } finally {
    changed()
  }
}

/** «Розділити переказ»: the bank operations the transfer was. Throws `LedgerApiError` (`not_eligible`, `conflict`, ...). */
export async function splitTransfer(orgId: string, txId: string): Promise<LedgerTransaction[]> {
  try {
    const out = (await apiCall('POST', `${org(orgId)}/transfers/${encodeURIComponent(txId)}/split`)) as { restored: LedgerTransaction[] }
    return out.restored
  } finally {
    changed()
  }
}

/**
 * The undo of transfers made in this browser (the toast): each is split, then each of its operations is written back as it
 * was before (the split gives them back without category, counterparty or period). A failure counts and the rest go on;
 * the journal reloads once at the end.
 */
export async function undoTransfers(
  orgId: string,
  made: readonly MadeOutcome[],
  o: { split?: (id: string) => Promise<unknown>; revert?: (before: LedgerTransaction) => Promise<unknown> } = {},
): Promise<{ done: number; failed: number }> {
  const split = o.split ?? ((id: string) => splitTransfer(orgId, id))
  const revert = o.revert ?? ((before: LedgerTransaction) => revertTransaction(orgId, toUiTransaction(orgId, before)))
  let done = 0
  let failed = 0
  await withoutNotifications(async () => {
    for (const m of made) {
      try {
        await split(m.id)
        for (const before of m.before) await revert(before)
        done++
      } catch {
        failed++
      }
    }
  })
  notifyTransfersChanged()
  return { done, failed }
}
