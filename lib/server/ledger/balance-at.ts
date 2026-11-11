// lib/server/ledger/balance-at.ts
// The balance of an account at the close of a day (S08 rule, shared by the journal and, since S12, the reports): the
// account's own `balanceMinor` minus everything that moved it after that day. The movement after a day comes from three
// `sum` aggregate queries over the actual operations, not from the rollups: Firestore cannot `sum` over a range of
// document ids. They are billed by index entries, so the cost does not grow with the history before the day.
import { AggregateField, FieldPath, type Query } from 'firebase-admin/firestore'
import { arrivalShiftOf } from '@/lib/domain/journal/balance'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { MAX_ARRIVAL_DAYS, type LedgerAccount } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from './deps'
import { transactionsCol } from './paths'
import type { Reader } from './reader'

/**
 * What the balance reads cost: the aggregate queries and the operation documents of the arrival correction. `ids`, when given,
 * collects the ids of those documents (a caller that counts distinct operations). `counted`, when given, is what
 * `countArrivals` counted in the same snapshot: each arrival query then reads no more than its count (the reports count first).
 */
export interface BalanceReadStats {
  docsRead: number
  aggregates: number
  ids?: Set<string>
  counted?: ReadonlyMap<string, number>
}

export function arrivalKey(accountId: string, day: string): string {
  return `${accountId}|${day}`
}

/**
 * The arrival documents `balancesAt` reads for `days` (the days before `today`, for each account), counted in the caller's
 * snapshot before any of them is read. Keyed by `arrivalKey`; one aggregate query each.
 */
export async function countArrivals(
  reader: Reader,
  deps: Pick<LedgerDeps, 'db'>,
  orgId: string,
  accounts: readonly LedgerAccount[],
  days: readonly string[],
  today: string,
): Promise<Map<string, number>> {
  const keys = accounts.flatMap((account) => [...new Set(days)].filter((day) => day < today).map((day) => ({ accountId: account.id, day })))
  const counts = await Promise.all(keys.map(async (k) => (await reader.aggregate(arrivalsQuery(deps, orgId, k.accountId, k.day).count())).data().count))
  return new Map(keys.map((k, i) => [arrivalKey(k.accountId, k.day), counts[i]]))
}

/**
 * The transfers into the account paid within MAX_ARRIVAL_DAYS of `day`: the only ones whose arrival day (S10b) can be on
 * the other side of `day` than their payment day. The listing query of the journal (index `toAccountId`, `paymentDate`,
 * `createdAt`), so no index of its own. Exported for the rollout check (scripts/check-transfers.ts).
 */
export function arrivalsQuery(deps: Pick<LedgerDeps, 'db'>, orgId: string, accountId: string, day: string): Query {
  return transactionsCol(deps.db, orgId)
    .where('toAccountId', '==', accountId)
    .where('paymentDate', '>=', addDays(day, -MAX_ARRIVAL_DAYS))
    .where('paymentDate', '<=', addDays(day, MAX_ARRIVAL_DAYS))
    .orderBy('paymentDate', 'desc')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
}

/** The sums by payment day place the money in of a transfer on the day it left; this moves it to the day it arrived. */
async function arrivalShift(reader: Reader, deps: Pick<LedgerDeps, 'db'>, orgId: string, accountId: string, day: string, stats: BalanceReadStats): Promise<number> {
  const limit = stats.counted?.get(arrivalKey(accountId, day))
  if (stats.counted !== undefined && limit === undefined) throw new Error(`the arrivals of ${accountId} on ${day} were not counted`)
  if (limit === 0) return 0
  const query = arrivalsQuery(deps, orgId, accountId, day)
  const snap = await reader.query(limit === undefined ? query : query.limit(limit))
  stats.docsRead += snap.size
  let shift = 0
  for (const d of snap.docs) {
    stats.ids?.add(d.id)
    const tx = parseTransaction(d.id, d.data())
    if (tx) shift += arrivalShiftOf(tx, day)
  }
  return shift
}

/**
 * The net movement of an account on every day after `day`: money in (income), money out (expense and transfer out, both
 * `amountMinor`) and transfers into the account (`toAmountMinor`), corrected by the arrival days of transfers (S10b).
 */
export async function netAfterDay(reader: Reader, deps: Pick<LedgerDeps, 'db'>, orgId: string, accountId: string, day: string, stats: BalanceReadStats): Promise<number> {
  const actualAfter = transactionsCol(deps.db, orgId).where('status', '==', 'actual').where('paymentDate', '>', day)
  const sum = async (q: Query, field: string): Promise<number> => {
    const agg = await reader.aggregate(q.aggregate({ total: AggregateField.sum(field) }))
    stats.aggregates++
    return agg.data().total ?? 0
  }
  const [income, outflow, transferIn, arrivals] = await Promise.all([
    sum(actualAfter.where('accountId', '==', accountId).where('type', '==', 'income'), 'amountMinor'),
    sum(actualAfter.where('accountId', '==', accountId).where('type', 'in', ['expense', 'transfer']), 'amountMinor'),
    sum(actualAfter.where('toAccountId', '==', accountId), 'toAmountMinor'),
    arrivalShift(reader, deps, orgId, accountId, day, stats),
  ])
  return income - outflow + transferIn + arrivals
}

/**
 * The balance of each account at the close of each day: `balanceMinor` for today and later (an actual operation is never
 * after today), else `balanceMinor` minus the movement after the day. Account id -> day -> balance.
 */
export async function balancesAt(
  reader: Reader,
  deps: Pick<LedgerDeps, 'db'>,
  orgId: string,
  accounts: readonly LedgerAccount[],
  days: readonly string[],
  today: string,
  stats: BalanceReadStats,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  await Promise.all(
    accounts.map(async (account) => {
      const byDay = new Map<string, number>()
      await Promise.all(
        [...new Set(days)].map(async (day) => {
          byDay.set(day, day >= today ? account.balanceMinor : account.balanceMinor - (await netAfterDay(reader, deps, orgId, account.id, day, stats)))
        }),
      )
      out.set(account.id, byDay)
    }),
  )
  return out
}
