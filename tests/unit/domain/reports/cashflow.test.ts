import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { categoryTypesOf } from '@/lib/domain/analytics-filter/kinds'
import { NO_TAG } from '@/lib/domain/journal/filter'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { buildCashFlowCore, rowOfStored } from '@/lib/domain/reports/cashflow'
import { factsFromRollupDocs, operationRollups, type DayRange } from '@/lib/domain/reports/facts'
import type { MoneyType } from '@/lib/domain/reports/types'
import { op } from './fixtures'

const OCT: DayRange = { from: '2026-10-01', to: '2026-10-31' }
const TYPES = categoryTypesOf([
  { id: 'cat-in', type: 'income' },
  { id: 'cat-ex', type: 'expense' },
])
const ACCOUNTS = ['main', 'vat']

/** The data of the S10f e2e: a sale of 500, rent 120, fuel 40 (tag), the VAT pair of 230 (excluded), a bank fee of 15, a transfer of 300. */
const OPS: LedgerTransaction[] = [
  op({ type: 'income', accountId: 'main', amountMinor: 50_000, paymentDate: '2026-10-02', categoryId: 'cat-in' }),
  op({ type: 'expense', accountId: 'main', amountMinor: 12_000, paymentDate: '2026-10-05', categoryId: 'cat-ex' }),
  op({ type: 'expense', accountId: 'main', amountMinor: 4_000, paymentDate: '2026-10-06', categoryId: 'cat-ex', tags: ['fuel'] }),
  op({ type: 'expense', accountId: 'main', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true }),
  op({ type: 'income', accountId: 'vat', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true }),
  op({ type: 'expense', accountId: 'vat', amountMinor: 1_500, paymentDate: '2026-10-08', categoryId: 'cat-ex' }),
  op({ type: 'transfer', accountId: 'main', toAccountId: 'vat', amountMinor: 30_000, paymentDate: '2026-10-09' }),
]

/** The Cash Flow the operations path gives: the S10f choice, then the operations' own rollups, then the builder. */
function cashFlow(ops: readonly LedgerTransaction[], choice: Partial<AnalyticsFilters> = {}, range: DayRange = OCT) {
  const filters: AnalyticsFilters = { ...EMPTY_ANALYTICS_FILTERS, ...choice }
  const chosen = filterForAnalytics([...ops], filters, TYPES)
  const accountIds = filters.accountIds.length > 0 ? filters.accountIds : ACCOUNTS
  const { docs } = operationRollups(chosen.operations, 'PLN', range, { accounts: new Set(accountIds), parts: ['cash', 'cashcat'] })
  return buildCashFlowCore(factsFromRollupDocs(docs), { ...range, accountIds, includeExcluded: chosen.includeExcluded, categoryTypes: TYPES })
}

describe('buildCashFlowCore', () => {
  it('buckets are the days of a period up to 31 days and the months above, each with its running net', () => {
    const oct = cashFlow(OPS)
    expect(oct.granularity).toBe('day')
    expect(oct.buckets).toHaveLength(31)
    expect(oct.buckets[1]).toEqual({ key: '2026-10-02', incomeBase: 50_000, expenseBase: 0, netBase: 50_000, runningNetBase: 50_000 })
    expect(oct.buckets[30].runningNetBase).toBe(50_000 - 17_500)
    const longer = cashFlow(OPS, {}, { from: '2026-10-01', to: '2026-11-01' })
    expect(longer.granularity).toBe('month')
    expect(longer.buckets.map((b) => [b.key, b.incomeBase, b.expenseBase])).toEqual([
      ['2026-10', 50_000, 17_500],
      ['2026-11', 0, 0],
    ])
  })

  it('the totals the S10f filters choose (the e2e data); transfers never count; the categories add up to the totals', () => {
    const cases: Array<[Partial<AnalyticsFilters>, [number, number]]> = [
      [{}, [50_000, 17_500]],
      [{ tagIds: ['vat'] }, [23_000, 23_000]],
      [{ tagIds: [NO_TAG] }, [50_000, 13_500]],
      [{ accountIds: ['vat'] }, [0, 1_500]],
      [{ types: ['expense'], categoryIds: ['cat-ex'] }, [0, 17_500]],
      [{ types: ['income'] }, [50_000, 0]],
      [{ types: ['income'], categoryIds: ['cat-ex'] }, [50_000, 17_500]],
    ]
    for (const [choice, [income, expense]] of cases) {
      const report = cashFlow(OPS, choice)
      const label = JSON.stringify(choice)
      expect([report.totals.incomeBase, report.totals.expenseBase], label).toEqual([income, expense])
      expect(report.totals.netBase, label).toBe(income - expense)
      const byType = (type: MoneyType): number => report.categories.filter((c) => c.type === type).reduce((s, c) => s + c.amountBase, 0)
      expect([byType('income'), byType('expense')], label).toEqual([income, expense])
    }
  })

  it('operations excluded from analytics go to «Виключено з аналітики»; a concrete tag counts them in (excludedCounted)', () => {
    const plain = cashFlow(OPS)
    expect(plain.excluded).toEqual({ incomeBase: 23_000, expenseBase: 23_000 })
    expect([plain.includeExcluded, plain.excludedCounted]).toEqual([false, false])
    const tagged = cashFlow(OPS, { tagIds: ['vat'] })
    expect(tagged.excluded).toBeNull()
    expect([tagged.includeExcluded, tagged.excludedCounted]).toEqual([true, true])
    // A concrete tag that chose no excluded operation: they are included, none was counted.
    expect(cashFlow(OPS, { tagIds: ['fuel'] }).excludedCounted).toBe(false)
  })

  it('the row of a category is the S10f rule: a deleted category and one of the other type are uncategorised', () => {
    const ops = [
      op({ type: 'expense', accountId: 'main', amountMinor: 1_000, paymentDate: '2026-10-05', categoryId: 'cat-gone' }),
      op({ type: 'expense', accountId: 'main', amountMinor: 2_000, paymentDate: '2026-10-06', categoryId: 'cat-in' }),
      op({ type: 'expense', accountId: 'main', amountMinor: 3_000, paymentDate: '2026-10-07', categoryId: 'cat-ex' }),
      op({ type: 'expense', accountId: 'main', amountMinor: 4_000, paymentDate: '2026-10-08' }),
    ]
    expect(cashFlow(ops).categories).toEqual([
      { row: '_none:expense', type: 'expense', amountBase: 7_000 },
      { row: 'cat-ex', type: 'expense', amountBase: 3_000 },
    ])
    expect(rowOfStored('income', '_none', TYPES)).toBe('_none:income')
    expect(rowOfStored('income', 'cat-in', TYPES)).toBe('cat-in')
  })

  it('one line per chosen account in its own currency, with its transfers in and out', () => {
    expect(cashFlow(OPS).accounts).toEqual([
      { accountId: 'main', inMinor: 50_000, outMinor: 16_000, transferInMinor: 0, transferOutMinor: 30_000 },
      { accountId: 'vat', inMinor: 0, outMinor: 1_500, transferInMinor: 30_000, transferOutMinor: 0 },
    ])
  })

  it('an amount in another currency counts by its base; the account line keeps the account currency', () => {
    const eur = op({ type: 'income', accountId: 'eur', currency: 'EUR', amountMinor: 5_000, paymentDate: '2026-10-10', base: { payment: 21_000, accrual: 21_000 } })
    const facts = factsFromRollupDocs(operationRollups([eur], 'PLN', OCT, { parts: ['cash', 'cashcat'] }).docs)
    const report = buildCashFlowCore(facts, { ...OCT, accountIds: ['eur'], includeExcluded: false, categoryTypes: TYPES })
    expect(report.totals.incomeBase).toBe(21_000)
    expect(report.accounts).toEqual([{ accountId: 'eur', inMinor: 5_000, outMinor: 0, transferInMinor: 0, transferOutMinor: 0 }])
  })
})
