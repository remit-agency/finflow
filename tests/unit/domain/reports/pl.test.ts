import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { categoryTypesOf } from '@/lib/domain/analytics-filter/kinds'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { factsFromRollupDocs, operationRollups, type DayRange } from '@/lib/domain/reports/facts'
import { buildPLCore } from '@/lib/domain/reports/pl'
import { op } from './fixtures'

const OCT: DayRange = { from: '2026-10-01', to: '2026-10-31' }
const TYPES = categoryTypesOf([
  { id: 'cat-in', type: 'income' },
  { id: 'cat-ex', type: 'expense' },
])

const OPS: LedgerTransaction[] = [
  op({ type: 'income', accountId: 'main', amountMinor: 50_000, paymentDate: '2026-10-02', categoryId: 'cat-in' }),
  op({ type: 'expense', accountId: 'main', amountMinor: 12_000, paymentDate: '2026-10-05', categoryId: 'cat-ex' }),
  op({ type: 'expense', accountId: 'main', amountMinor: 4_000, paymentDate: '2026-10-06', categoryId: 'cat-ex', tags: ['fuel'] }),
  op({ type: 'expense', accountId: 'main', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true }),
  op({ type: 'income', accountId: 'vat', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true }),
  op({ type: 'expense', accountId: 'vat', amountMinor: 1_500, paymentDate: '2026-10-08', categoryId: 'cat-ex' }),
  op({ type: 'transfer', accountId: 'main', toAccountId: 'vat', amountMinor: 30_000, paymentDate: '2026-10-09' }),
]

function pl(ops: readonly LedgerTransaction[], range: DayRange, choice: Partial<AnalyticsFilters> = {}) {
  const chosen = filterForAnalytics([...ops], { ...EMPTY_ANALYTICS_FILTERS, ...choice }, TYPES)
  const { docs } = operationRollups(chosen.operations, 'PLN', range, { parts: ['pl'] })
  return buildPLCore(factsFromRollupDocs(docs), { ...range, includeExcluded: chosen.includeExcluded, categoryTypes: TYPES })
}

describe('buildPLCore', () => {
  it('the months of the period are the columns; a row per category with a value per month; totals and profit', () => {
    const report = pl(OPS, OCT)
    expect(report.months).toEqual(['2026-10'])
    expect(report.rows).toEqual([
      { row: 'cat-in', type: 'income', values: [50_000], total: 50_000 },
      { row: 'cat-ex', type: 'expense', values: [17_500], total: 17_500 },
    ])
    expect(report.totals).toEqual({ incomeBase: 50_000, expenseBase: 17_500, profitBase: 32_500 })
    expect(report.excluded).toEqual({ incomeBase: 23_000, expenseBase: 23_000 })
  })

  it('an accrual period spreads over its months; a part of a month counts by its days; a date outside the period does not count', () => {
    const lease = op({ type: 'expense', accountId: 'main', amountMinor: 61_000, paymentDate: '2026-10-12', categoryId: 'cat-ex', accrual: { mode: 'period', from: '2026-09-15', to: '2026-11-14' } })
    const late = op({ type: 'expense', accountId: 'main', amountMinor: 5_000, paymentDate: '2026-10-12', categoryId: 'cat-ex', accrual: { mode: 'date', date: '2026-09-30' } })
    const quarter = pl([lease, late], { from: '2026-09-01', to: '2026-11-30' })
    expect(quarter.months).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(quarter.rows).toEqual([{ row: 'cat-ex', type: 'expense', values: [16_000 + 5_000, 31_000, 14_000], total: 66_000 }])
    expect(pl([lease, late], { from: '2026-10-10', to: '2026-10-20' }).rows).toEqual([{ row: 'cat-ex', type: 'expense', values: [11_000], total: 11_000 }])
    expect(pl([late], OCT).rows).toEqual([])
  })

  it('a concrete tag counts the excluded operations in the rows (excludedCounted)', () => {
    const report = pl(OPS, OCT, { tagIds: ['vat'] })
    expect(report.rows).toEqual([
      { row: '_none:income', type: 'income', values: [23_000], total: 23_000 },
      { row: '_none:expense', type: 'expense', values: [23_000], total: 23_000 },
    ])
    expect(report.excluded).toBeNull()
    expect(report.excludedCounted).toBe(true)
  })

  it('a deleted category and one of the other type are the uncategorised row', () => {
    const ops = [
      op({ type: 'expense', accountId: 'main', amountMinor: 1_000, paymentDate: '2026-10-05', categoryId: 'cat-gone' }),
      op({ type: 'expense', accountId: 'main', amountMinor: 2_000, paymentDate: '2026-10-06', categoryId: 'cat-in' }),
      op({ type: 'income', accountId: 'main', amountMinor: 3_000, paymentDate: '2026-10-07', categoryId: 'cat-gone-in' }),
    ]
    expect(pl(ops, OCT).rows.map((r) => [r.row, r.total])).toEqual([
      ['_none:income', 3_000],
      ['_none:expense', 3_000],
    ])
  })
})
