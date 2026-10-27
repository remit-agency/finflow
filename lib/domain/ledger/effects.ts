import type { LedgerTransaction } from './types'

/** Change of each account balance (minor units) caused by an operation. Planned operations have none. */
export function balanceEffects(tx: LedgerTransaction): Record<string, number> {
  if (tx.status !== 'actual') return {}
  switch (tx.type) {
    case 'income':
      return { [tx.accountId]: tx.amountMinor }
    case 'expense':
      return { [tx.accountId]: -tx.amountMinor }
    case 'transfer':
      return { [tx.accountId]: -tx.amountMinor, [tx.toAccountId as string]: tx.toAmountMinor as number }
  }
}

export function mergeEffects(...parts: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of parts) {
    for (const [id, delta] of Object.entries(part)) out[id] = (out[id] ?? 0) + delta
  }
  for (const id of Object.keys(out)) if (out[id] === 0) delete out[id]
  return out
}

export function negateEffects(effects: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(effects).map(([id, delta]) => [id, delta === 0 ? 0 : -delta]))
}
