// lib/domain/forecast/balances.ts
// The balances of an account at the close of each day of a month, rolled back from one anchor day with the daily movement of
// the rollups (S13): the close of the day before is the close of the day less the movement of that day.
import { addDays } from '@/lib/domain/ledger/days'
import type { RollupFlat } from '@/lib/domain/ledger/rollups'

/**
 * The movement of an account on one day in its own currency: money in less money out, transfers in and out included. Pass
 * both twins of its `cash_` rollup (the analytics document and the excluded `x_` one): an excluded operation moves the balance too.
 */
export function accountMovementMinor(docs: ReadonlyArray<RollupFlat | undefined>): number {
  let movement = 0
  for (const flat of docs) {
    if (flat === undefined) continue
    movement += (flat.inMinor ?? 0) - (flat.outMinor ?? 0) + (flat.transferInMinor ?? 0) - (flat.transferOutMinor ?? 0)
  }
  return movement
}

/**
 * The close of every day from `firstDay` to `anchorDay`, both included. `anchorBalance` is the close of `anchorDay`; a day
 * missing from `movementByDay` did not move the account. Empty when `anchorDay` is before `firstDay`.
 */
export function rollBackBalances(anchorDay: string, anchorBalance: number, movementByDay: ReadonlyMap<string, number>, firstDay: string): Map<string, number> {
  const out = new Map<string, number>()
  let balance = anchorBalance
  for (let day = anchorDay; day >= firstDay; day = addDays(day, -1)) {
    out.set(day, balance)
    balance -= movementByDay.get(day) ?? 0
  }
  return out
}
