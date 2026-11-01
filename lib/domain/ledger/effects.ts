import type { LedgerTransaction } from './types'

/** The day the target account of a transfer receives the money: its own `toDate` when it has one (S10b), else the payment day. */
export function receivedOn(tx: Pick<LedgerTransaction, 'paymentDate' | 'toDate'>): string {
  return tx.toDate ?? tx.paymentDate
}

/** One movement of one account on one day, in minor units. */
export interface DatedEffect {
  accountId: string
  day: string
  delta: number
}

/**
 * How an operation moves the accounts and on which day: an income or an expense on its payment day; a transfer takes the
 * money off its account on the payment day and puts it on the target on the arrival day (S10b). Planned operations move
 * nothing. The single owner of «which account, when, how much»: the balances, the rollups and the journal read it.
 */
export function datedEffects(tx: LedgerTransaction): DatedEffect[] {
  if (tx.status !== 'actual') return []
  switch (tx.type) {
    case 'income':
      return [{ accountId: tx.accountId, day: tx.paymentDate, delta: tx.amountMinor }]
    case 'expense':
      return [{ accountId: tx.accountId, day: tx.paymentDate, delta: -tx.amountMinor }]
    case 'transfer':
      return [
        { accountId: tx.accountId, day: tx.paymentDate, delta: -tx.amountMinor },
        { accountId: tx.toAccountId as string, day: receivedOn(tx), delta: tx.toAmountMinor as number },
      ]
  }
}

/** Change of each account balance (minor units) caused by an operation, whatever the day. Planned operations have none. */
export function balanceEffects(tx: LedgerTransaction): Record<string, number> {
  return mergeEffects(...datedEffects(tx).map((e) => ({ [e.accountId]: e.delta })))
}

export function mergeEffects(...parts: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of parts) {
    for (const [id, delta] of Object.entries(part)) out[id] = (Object.hasOwn(out, id) ? out[id] : 0) + delta
  }
  for (const id of Object.keys(out)) if (out[id] === 0) delete out[id]
  return out
}

export function negateEffects(effects: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(effects).map(([id, delta]) => [id, delta === 0 ? 0 : -delta]))
}
