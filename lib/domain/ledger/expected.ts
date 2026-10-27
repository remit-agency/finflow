import { baseOf } from './build'
import { balanceEffects } from './effects'
import { addInto, contributions, type RollupDocs } from './rollups'
import type { LedgerAccount, LedgerTransaction } from './types'

export interface ExpectedLedger {
  /** Per account id: opening + sum of the effects of its actual operations. */
  balances: Record<string, number>
  rollups: RollupDocs
  /** Ids of operations that cannot be counted (missing account, missing base amounts). */
  invalid: string[]
}

/** True when the operation can be turned into effects and contributions. */
function countable(tx: LedgerTransaction, baseCurrency: string, known: Record<string, number>): boolean {
  if (tx.status !== 'actual') return true
  if (!Object.keys(balanceEffects(tx)).every((id) => id in known)) return false
  return tx.type === 'transfer' || baseOf(tx, baseCurrency) !== null
}

/** The oracle: what balances and rollups must be, computed from scratch from the operations. */
export function computeLedger(accounts: LedgerAccount[], txs: LedgerTransaction[], baseCurrency: string): ExpectedLedger {
  const balances: Record<string, number> = Object.fromEntries(accounts.map((a) => [a.id, a.openingMinor]))
  const rollups: RollupDocs = new Map()
  const invalid: string[] = []
  for (const tx of txs) {
    if (!countable(tx, baseCurrency, balances)) {
      invalid.push(tx.id)
      continue
    }
    for (const [id, delta] of Object.entries(balanceEffects(tx))) balances[id] += delta
    addInto(rollups, contributions(tx, baseCurrency))
  }
  return { balances, rollups, invalid }
}
