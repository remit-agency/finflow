// lib/domain/reports/cashflow.ts
// Cash Flow by payment date (S12) from the facts of either path: buckets (days up to 31 days, months above), totals, one
// line per chosen account, the category rows (the S10f rule `kindRowOf`), and «Виключено з аналітики». Transfers never
// count as money in or out; the operations excluded from analytics only with a concrete tag (`includeExcluded`).
import { kindRowOf, noCategoryId, type CategoryTypes } from '@/lib/domain/analytics-filter/kinds'
import { addDays, daysInRange, monthOf, monthsBetween } from '@/lib/domain/ledger/days'
import { NO_CATEGORY } from '@/lib/domain/ledger/rollups'
import {
  CASHFLOW_DAY_BUCKETS_MAX_DAYS,
  type AccountMovement,
  type CashFlowBucket,
  type CashFlowReport,
  type CategoryAmounts,
  type CategoryLine,
  type DayCells,
  type MoneyType,
  type ReportFacts,
  type Totals,
} from './types'

export interface CashFlowInput {
  from: string
  to: string
  /** The accounts the report shows: the chosen ones, or every account. */
  accountIds: readonly string[]
  includeExcluded: boolean
  /** The company's categories (`categoryTypesOf`). */
  categoryTypes: CategoryTypes
}

export type CashFlowCore = Pick<CashFlowReport, 'granularity' | 'totals' | 'buckets' | 'accounts' | 'categories' | 'excluded' | 'includeExcluded' | 'excludedCounted'>

/** The report row of a stored rollup category key (`_none` when the operation had none): the S10f rule `kindRowOf`. */
export function rowOfStored(type: MoneyType, stored: string, types: CategoryTypes): string {
  return kindRowOf({ type, categoryId: stored === NO_CATEGORY ? undefined : stored }, types) ?? noCategoryId(type)
}

/** Income rows before expense rows, the larger amount first, then the row id: one order for every response. */
export function byTypeThenAmount<T extends { type: MoneyType; row: string }>(amount: (x: T) => number): (a: T, b: T) => number {
  return (a, b) => (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1) || amount(b) - amount(a) || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0)
}

export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day)
  return out
}

/** The category lines of the month documents, by report row (several stored keys can share one: a deleted category). */
export function categoryLines(sources: ReadonlyArray<Map<string, CategoryAmounts>>, types: CategoryTypes): CategoryLine[] {
  const byRow = new Map<string, CategoryLine>()
  for (const source of sources) {
    for (const [stored, a] of source) {
      for (const [type, value] of [['income', a.incomeBase], ['expense', a.expenseBase]] as const) {
        if (value === 0) continue
        const row = rowOfStored(type, stored, types)
        const key = `${type}|${row}`
        const line = byRow.get(key) ?? { row, type, amountBase: 0 }
        line.amountBase += value
        byRow.set(key, line)
      }
    }
  }
  return [...byRow.values()].filter((l) => l.amountBase !== 0).sort(byTypeThenAmount((l: CategoryLine) => l.amountBase))
}

export function buildCashFlowCore(facts: ReportFacts, input: CashFlowInput): CashFlowCore {
  const granularity = daysInRange(input.from, input.to) > CASHFLOW_DAY_BUCKETS_MAX_DAYS ? 'month' : 'day'
  const keys = granularity === 'day' ? daysOf(input.from, input.to) : monthsBetween(input.from, input.to)
  const sums = new Map<string, Totals>(keys.map((key) => [key, { incomeBase: 0, expenseBase: 0 }]))
  const excluded: Totals = { incomeBase: 0, expenseBase: 0 }
  let excludedCounted = false

  const accounts: AccountMovement[] = input.accountIds.map((accountId) => {
    const line: AccountMovement = { accountId, inMinor: 0, outMinor: 0, transferInMinor: 0, transferOutMinor: 0 }
    const count = (cells: DayCells | undefined, isExcluded: boolean): void => {
      for (const [day, c] of cells ?? []) {
        if (day < input.from || day > input.to) continue
        if (isExcluded && !input.includeExcluded) {
          excluded.incomeBase += c.inBase
          excluded.expenseBase += c.outBase
          continue
        }
        line.inMinor += c.inMinor
        line.outMinor += c.outMinor
        line.transferInMinor += c.transferInMinor
        line.transferOutMinor += c.transferOutMinor
        const bucket = sums.get(granularity === 'day' ? day : monthOf(day))
        if (bucket) {
          bucket.incomeBase += c.inBase
          bucket.expenseBase += c.outBase
        }
        if (isExcluded && (c.inBase !== 0 || c.outBase !== 0)) excludedCounted = true
      }
    }
    count(facts.cash.get(accountId), false)
    count(facts.excludedCash.get(accountId), true)
    return line
  })

  let running = 0
  const buckets: CashFlowBucket[] = keys.map((key) => {
    const s = sums.get(key) ?? { incomeBase: 0, expenseBase: 0 }
    const netBase = s.incomeBase - s.expenseBase
    running += netBase
    return { key, incomeBase: s.incomeBase, expenseBase: s.expenseBase, netBase, runningNetBase: running }
  })
  const incomeBase = buckets.reduce((sum, b) => sum + b.incomeBase, 0)
  const expenseBase = buckets.reduce((sum, b) => sum + b.expenseBase, 0)
  const categories = categoryLines(input.includeExcluded ? [facts.cashCategories, facts.excludedCashCategories] : [facts.cashCategories], input.categoryTypes)

  return {
    granularity,
    totals: { incomeBase, expenseBase, netBase: incomeBase - expenseBase },
    buckets,
    accounts,
    categories,
    excluded: input.includeExcluded ? null : excluded,
    includeExcluded: input.includeExcluded,
    excludedCounted,
  }
}
