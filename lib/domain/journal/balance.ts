import type { LedgerTransaction } from '@/lib/domain/ledger/types'

export interface DayOps {
  day: string
  /** Every actual operation of the account on that day, in listing order (newest first), with its effect on the account. */
  ops: { id: string; effect: number }[]
}

/**
 * Balance of one account after each operation of the days on a page.
 *
 * `days` are in listing order (newest first); `netAfterFirstDay` is the net movement of the account on all days newer
 * than `days[0]`; `netBetween[i]` is the net movement on the days strictly between `days[i]` and `days[i + 1]`.
 * Walking from the balance now: the balance after the newest operation of a day is the balance at the end of that day;
 * removing each operation's effect gives the balance after the one listed next.
 */
export function balancesAfter(balanceNow: number, netAfterFirstDay: number, days: DayOps[], netBetween: number[]): Map<string, number> {
  const out = new Map<string, number>()
  let running = balanceNow - netAfterFirstDay
  days.forEach((d, i) => {
    for (const op of d.ops) {
      out.set(op.id, running)
      running -= op.effect
    }
    running -= netBetween[i] ?? 0
  })
  return out
}

/**
 * What the money in of a transfer adds to «the net movement of its target after `day`» beyond the sums by payment day
 * (S10b, `toDate`): + the amount when it left on or before `day` but arrived after it, − the amount when it left after
 * `day` but arrived on or before it; 0 otherwise, and for anything but an actual transfer with an arrival day of its own.
 */
export function arrivalShiftOf(tx: LedgerTransaction, day: string): number {
  if (tx.type !== 'transfer' || tx.status !== 'actual' || tx.toDate === undefined) return 0
  const amount = tx.toAmountMinor as number
  if (tx.paymentDate <= day && tx.toDate > day) return amount
  if (tx.paymentDate > day && tx.toDate <= day) return -amount
  return 0
}
