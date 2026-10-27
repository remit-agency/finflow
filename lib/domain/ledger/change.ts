import { balanceEffects, mergeEffects, negateEffects } from './effects'
import { addInto, contributions, type RollupDocs } from './rollups'
import type { LedgerTransaction } from './types'

export interface ChangeSet {
  /** Per account: change of `balanceMinor`. No zero entries. */
  balanceDeltas: Record<string, number>
  /** Per rollup document: increments (negative to take back). No zero entries. */
  rollupDeltas: RollupDocs
}

/**
 * The single rule for every write: create = +next, delete = -prior, update = -prior +next.
 * The server applies exactly this inside one transaction; the tests apply it to a model.
 */
export function changeSet(prior: LedgerTransaction | null, next: LedgerTransaction | null, baseCurrency: string): ChangeSet {
  const balanceDeltas = mergeEffects(
    next ? balanceEffects(next) : {},
    prior ? negateEffects(balanceEffects(prior)) : {},
  )
  const rollupDeltas: RollupDocs = new Map()
  if (next) addInto(rollupDeltas, contributions(next, baseCurrency, 1))
  if (prior) addInto(rollupDeltas, contributions(prior, baseCurrency, -1))
  return { balanceDeltas, rollupDeltas }
}
