import type { LinkRequest } from '@/lib/domain/banking/link-input'
import type { BankSessionAccount, BankStatus } from '@/lib/domain/banking/status-types'
import { notifyLedgerChanged } from './ledger-events'
import { readApiError } from './ledger-client'

const EVENT = 'finflow:bank-changed'
/** A sync step moves at most 25 operations or one bank page; this is only a stop against a runaway loop. */
const MAX_STEPS = 200

/** Called when the bank data changed (a sync ended, an account was linked, a connection dropped). */
export function notifyBankChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onBankChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/bank`

export async function fetchBankStatus(orgId: string, signal?: AbortSignal): Promise<BankStatus> {
  const res = await fetch(base(orgId), { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as BankStatus
}

export async function fetchSessionAccounts(orgId: string, connectionId: string): Promise<BankSessionAccount[]> {
  const res = await fetch(`${base(orgId)}/connections/${encodeURIComponent(connectionId)}`, { credentials: 'same-origin' })
  if (!res.ok) throw await readApiError(res)
  return ((await res.json()) as { accounts: BankSessionAccount[] }).accounts
}

export async function linkBankAccount(orgId: string, body: LinkRequest): Promise<{ bankAccountId: string; accountId: string }> {
  const res = await fetch(`${base(orgId)}/accounts`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await readApiError(res)
  notifyBankChanged()
  return (await res.json()) as { bankAccountId: string; accountId: string }
}

export async function disconnectBank(orgId: string, connectionId: string): Promise<void> {
  const res = await fetch(`${base(orgId)}/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await readApiError(res)
  notifyBankChanged()
}

export interface SyncTotals {
  imported: number
  skipped: number
  failed: number
  bankBalanceMinor: number | null
  differenceMinor: number | null
  /** Another tab or request is already syncing this account. */
  busy: boolean
}

interface StepAnswer {
  imported: number
  skipped: number
  failed: number
  done: boolean
  bankBalanceMinor: number | null
  differenceMinor: number | null
}

/**
 * Runs the sync of one bank account to the end: one request per step while the server says `done: false`.
 * Tells the journal to reload when operations arrived. Throws `LedgerApiError` (status, code) on a failure;
 * `already_running` is not a failure, it returns `busy: true`.
 */
export async function syncBankAccount(
  orgId: string,
  bankAccountId: string,
  opts: { signal?: AbortSignal; onProgress?: (totals: SyncTotals) => void } = {},
): Promise<SyncTotals> {
  const totals: SyncTotals = { imported: 0, skipped: 0, failed: 0, bankBalanceMinor: null, differenceMinor: null, busy: false }
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch(`${base(orgId)}/sync`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId }),
        signal: opts.signal,
      })
      if (!res.ok) {
        const error = await readApiError(res)
        if (error.code === 'already_running') {
          totals.busy = true
          break
        }
        throw error
      }
      const answer = (await res.json()) as StepAnswer
      totals.imported += answer.imported
      totals.skipped += answer.skipped
      totals.failed += answer.failed
      if (answer.done) {
        totals.bankBalanceMinor = answer.bankBalanceMinor
        totals.differenceMinor = answer.differenceMinor
        break
      }
      opts.onProgress?.({ ...totals })
    }
  } finally {
    if (totals.imported > 0) notifyLedgerChanged()
    notifyBankChanged()
  }
  return totals
}
