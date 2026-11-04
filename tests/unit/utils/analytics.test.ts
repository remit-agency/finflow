import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, type AnalyticsFilters, type AnalyticsSelection } from '@/lib/domain/analytics-filter/filter'
import { NO_TAG } from '@/lib/domain/journal/filter'
import { buildCalendar, buildCashFlow, buildPL, type CashFlowReport } from '@/lib/utils/analytics'
import { resolvePeriod } from '@/lib/utils/period'
import type { Category, Transaction } from '@/types'
import { makeTx } from '../helpers/fixtures'

/** The selection the reports take: the operations, and whether the ones excluded from analytics are among them. */
const sel = (operations: Transaction[], includeExcluded = false): AnalyticsSelection<Transaction> => ({ operations, includeExcluded })

let seq = 0
function tx(type: Transaction['type'], amount: number, iso: string, categoryId?: string): Transaction {
  seq += 1
  return makeTx({
    id: `t${seq}`,
    orgId: 'org',
    accountId: 'acc',
    type,
    amount,
    currency: 'UAH',
    categoryId,
    date: new Date(iso),
  })
}

function category(id: string, type: Category['type'], name: string): Category {
  return { id, orgId: 'org', name, type, color: '#000000', createdAt: new Date(0) } as Category
}

// Friday 23 Oct 2026; the week is Mon 19 - Sun 25 Oct.
const NOW = new Date('2026-10-23T12:00:00Z')

describe('buildCashFlow over a period', () => {
  it('current week: day buckets Monday to Sunday; transactions just outside the week are left out', () => {
    const txs = [
      tx('income', 1000, '2026-10-18T23:59:59.999Z'), // Sunday of the previous week
      tx('income', 100, '2026-10-19T00:00:00.000Z'), // Monday 00:00
      tx('expense', 30, '2026-10-21T10:00:00Z'),
      tx('income', 5, '2026-10-25T23:59:59.999Z'), // Sunday, last millisecond
      tx('expense', 2000, '2026-10-26T00:00:00.000Z'), // next Monday
    ]
    const report = buildCashFlow(sel(txs), resolvePeriod({ preset: 'currentWeek' }, NOW), 'uk')
    expect(report.granularity).toBe('day')
    expect(report.buckets.map((b) => b.key)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ])
    expect(report.buckets[0].label).toBe('19 жов')
    expect(report.buckets.map((b) => b.net)).toEqual([100, 0, -30, 0, 0, 0, 5])
    // The running balance starts at 0 at the start of the range.
    expect(report.buckets.map((b) => b.balance)).toEqual([100, 100, 70, 70, 70, 70, 75])
    expect(report.buckets.reduce((s, b) => s + b.income, 0)).toBe(105)
  })

  it('current year: twelve month buckets, January to December, cumulative balance', () => {
    const txs = [
      tx('income', 500, '2025-12-31T23:59:59Z'), // previous year
      tx('income', 300, '2026-01-01T00:00:00Z'),
      tx('expense', 100, '2026-03-15T10:00:00Z'),
      tx('transfer', 999, '2026-03-16T10:00:00Z'), // transfers do not count
      tx('income', 50, '2026-12-31T23:59:59.999Z'),
    ]
    const report = buildCashFlow(sel(txs), resolvePeriod({ preset: 'currentYear' }, NOW), 'uk')
    expect(report.granularity).toBe('month')
    expect(report.buckets).toHaveLength(12)
    expect(report.buckets[0]).toMatchObject({ key: '2026-01', label: 'Січ 26', income: 300, net: 300, balance: 300 })
    expect(report.buckets[2]).toMatchObject({ key: '2026-03', expense: 100, net: -100, balance: 200 })
    expect(report.buckets[11]).toMatchObject({ key: '2026-12', label: 'Гру 26', income: 50, balance: 250 })
  })

  it('previous year shows only last year', () => {
    const txs = [tx('income', 500, '2025-06-15T12:00:00Z'), tx('income', 300, '2026-10-23T08:00:00Z')]
    const report = buildCashFlow(sel(txs), resolvePeriod({ preset: 'prevYear' }, NOW), 'uk')
    expect(report.buckets[0].key).toBe('2025-01')
    expect(report.buckets.reduce((s, b) => s + b.income, 0)).toBe(500)
  })

  it('buckets by the UTC day: 23:30 UTC stays on its UTC day', () => {
    const txs = [tx('income', 10, '2026-10-20T23:30:00Z')]
    const report = buildCashFlow(sel(txs), resolvePeriod({ preset: 'currentWeek' }, NOW), 'uk')
    expect(report.buckets.find((b) => b.key === '2026-10-20')?.income).toBe(10)
  })

  it('custom range longer than 31 days: months it touches; days before the start are left out', () => {
    const txs = [
      tx('income', 1, '2026-03-11T23:59:59Z'),
      tx('income', 20, '2026-03-12T00:00:00Z'),
      tx('income', 300, '2026-04-18T23:00:00Z'),
      tx('income', 4000, '2026-04-19T00:00:00Z'),
    ]
    const range = resolvePeriod(
      { preset: 'custom', start: new Date('2026-03-12T00:00:00Z'), end: new Date('2026-04-18T00:00:00Z') },
      NOW,
    )
    const report = buildCashFlow(sel(txs), range, 'uk')
    expect(report.granularity).toBe('month')
    expect(report.buckets.map((b) => [b.key, b.income])).toEqual([['2026-03', 20], ['2026-04', 300]])
  })

  it('31 days are still days, 32 days are months', () => {
    const at = (iso: string) => new Date(`${iso}T00:00:00Z`)
    const days31 = resolvePeriod({ preset: 'custom', start: at('2026-01-01'), end: at('2026-01-31') }, NOW)
    const days32 = resolvePeriod({ preset: 'custom', start: at('2026-01-01'), end: at('2026-02-01') }, NOW)
    expect(buildCashFlow(sel([]), days31, 'uk')).toMatchObject({ granularity: 'day' })
    expect(buildCashFlow(sel([]), days31, 'uk').buckets).toHaveLength(31)
    expect(buildCashFlow(sel([]), days32, 'uk').granularity).toBe('month')
    expect(buildCashFlow(sel([]), days32, 'uk').buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02'])
  })

  it('current month (31 days) is bucketed by day', () => {
    const report = buildCashFlow(sel([]), resolvePeriod({ preset: 'currentMonth' }, NOW), 'uk')
    expect(report.granularity).toBe('day')
    expect(report.buckets).toHaveLength(31)
    expect(report.buckets[30].label).toBe('31 жов')
  })

  it('labels follow the UI language: the first three letters of the month name', () => {
    const year = resolvePeriod({ preset: 'currentYear' }, NOW)
    const month = (locale: 'uk' | 'pl' | 'en') => buildCashFlow(sel([]), year, locale).buckets.map((b) => b.label)
    expect(month('uk')).toEqual([
      'Січ 26', 'Лют 26', 'Бер 26', 'Кві 26', 'Тра 26', 'Чер 26', 'Лип 26', 'Сер 26', 'Вер 26', 'Жов 26', 'Лис 26', 'Гру 26',
    ])
    expect(month('pl')).toEqual([
      'Sty 26', 'Lut 26', 'Mar 26', 'Kwi 26', 'Maj 26', 'Cze 26', 'Lip 26', 'Sie 26', 'Wrz 26', 'Paź 26', 'Lis 26', 'Gru 26',
    ])
    expect(month('en')).toEqual([
      'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026',
    ])
    const day = (locale: 'uk' | 'pl' | 'en') =>
      buildCashFlow(sel([]), resolvePeriod({ preset: 'currentMonth' }, NOW), locale).buckets[18].label
    expect([day('uk'), day('pl'), day('en')]).toEqual(['19 жов', '19 paź', '19 Oct'])
  })

  it('all time spans the transactions; nothing to show without transactions', () => {
    const all = resolvePeriod({ preset: 'allTime' }, NOW)
    expect(buildCashFlow(sel([]), all, 'uk')).toEqual({ granularity: 'month', buckets: [], excludedCounted: false })
    const report = buildCashFlow(sel([tx('income', 10, '2025-11-03T10:00:00Z'), tx('expense', 4, '2026-01-20T10:00:00Z')]), all, 'uk')
    expect(report.buckets.map((b) => b.key)).toEqual(['2025-11', '2025-12', '2026-01'])
    expect(report.buckets[2].balance).toBe(6)
  })
})

describe('buildPL over a period', () => {
  const categories = [category('sales', 'income', 'Продажі'), category('rent', 'expense', 'Оренда')]
  const NONE = 'Bez kategorii'

  it('aggregates the range by category and month; transfers and outside transactions do not count', () => {
    const txs = [
      tx('income', 100, '2026-10-19T00:00:00Z', 'sales'),
      tx('income', 50, '2026-10-25T23:59:59.999Z'), // no category
      tx('expense', 40, '2026-10-20T12:00:00Z', 'rent'),
      tx('expense', 7, '2026-10-21T12:00:00Z', 'gone'), // unknown category -> the "no category" rows
      tx('transfer', 1000, '2026-10-21T12:00:00Z'),
      tx('income', 900, '2026-10-18T23:59:59.999Z', 'sales'), // previous week
    ]
    const { monthKeys, rows } = buildPL(sel(txs), categories, resolvePeriod({ preset: 'currentWeek' }, NOW), NONE)
    expect(monthKeys).toEqual(['2026-10'])
    expect(rows.map((r) => [r.categoryId, r.total])).toEqual([
      ['sales', 100],
      ['rent', 40],
      ['__uncategorized_income', 50],
      ['__uncategorized_expense', 7],
    ])
    expect(rows[0].months).toEqual({ '2026-10': 100 })
    // The name of the two "no category" rows is the one the caller passes (the UI language).
    expect(rows.slice(2).map((r) => r.categoryName)).toEqual([NONE, NONE])
  })

  it('a week across two months has two month columns', () => {
    // Thursday 1 Jan 2026: the week is 29 Dec 2025 - 4 Jan 2026.
    const txs = [tx('income', 10, '2025-12-30T10:00:00Z', 'sales'), tx('income', 5, '2026-01-02T10:00:00Z', 'sales')]
    const { monthKeys, rows } = buildPL(sel(txs), categories, resolvePeriod({ preset: 'currentWeek' }, new Date('2026-01-01T10:00:00Z')), NONE)
    expect(monthKeys).toEqual(['2025-12', '2026-01'])
    expect(rows[0]).toMatchObject({ total: 15, months: { '2025-12': 10, '2026-01': 5 } })
  })

  it('current year has twelve columns; a custom range only its months', () => {
    expect(buildPL(sel([]), categories, resolvePeriod({ preset: 'currentYear' }, NOW), NONE).monthKeys).toHaveLength(12)
    const custom = resolvePeriod(
      { preset: 'custom', start: new Date('2026-03-12T00:00:00Z'), end: new Date('2026-04-18T00:00:00Z') },
      NOW,
    )
    const { monthKeys, rows } = buildPL(sel([tx('expense', 25, '2026-04-18T22:00:00Z', 'rent'), tx('expense', 99, '2026-03-11T22:00:00Z', 'rent')]), categories, custom, NONE)
    expect(monthKeys).toEqual(['2026-03', '2026-04'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ categoryId: 'rent', total: 25, months: { '2026-03': 0, '2026-04': 25 } })
  })

  it('all time without transactions is empty', () => {
    expect(buildPL(sel([]), categories, resolvePeriod({ preset: 'allTime' }, NOW), NONE)).toEqual({ monthKeys: [], rows: [], excludedCounted: false })
  })

  it('names the rows with nameOf when given and with the stored name otherwise', () => {
    const range = resolvePeriod({ preset: 'currentWeek' }, NOW)
    const txs = [tx('income', 100, '2026-10-19T00:00:00Z', 'sales'), tx('expense', 40, '2026-10-20T12:00:00Z', 'rent')]
    const stored = buildPL(sel(txs), categories, range, NONE)
    expect(stored.rows.map((r) => r.categoryName)).toEqual(['Продажі', 'Оренда'])

    const shown = buildPL(sel(txs), categories, range, NONE, (cat) => `${cat.type}:${cat.name}`)
    expect(shown.rows.map((r) => r.categoryName)).toEqual(['income:Продажі', 'expense:Оренда'])
    // Only the label changes: ids, types and sums are the same.
    expect(shown.rows.map((r) => [r.categoryId, r.type, r.total])).toEqual(
      stored.rows.map((r) => [r.categoryId, r.type, r.total]),
    )
  })
})

describe('operations excluded from analytics (S10t)', () => {
  it('Cash Flow and P&L leave them out', () => {
    const vatIn = { ...tx('income', 230, '2026-10-20T10:00:00Z', 'cat-in'), excluded: true }
    const vatOut = { ...tx('expense', 230, '2026-10-20T11:00:00Z', 'cat-ex'), excluded: true }
    const sale = tx('income', 1000, '2026-10-21T10:00:00Z', 'cat-in')
    const period = resolvePeriod({ preset: 'currentMonth' }, NOW)
    const flow = buildCashFlow(sel([vatIn, vatOut, sale]), period, 'uk')
    expect(flow.buckets.reduce((sum, b) => sum + b.income, 0)).toBe(1000)
    expect(flow.buckets.reduce((sum, b) => sum + b.expense, 0)).toBe(0)
    const pl = buildPL(sel([vatIn, vatOut, sale]), [category('cat-in', 'income', 'Sprzedaż'), category('cat-ex', 'expense', 'Koszty')], period, 'Bez kategorii')
    expect(pl.rows.map((r) => [r.categoryId, r.total])).toEqual([['cat-in', 1000]])
  })
})

describe('report filters (S10f)', () => {
  const period = resolvePeriod({ preset: 'currentMonth' }, NOW)
  const NONE = 'Bez kategorii'
  const totals = (report: CashFlowReport): [number, number] => [
    report.buckets.reduce((s, b) => s + b.income, 0),
    report.buckets.reduce((s, b) => s + b.expense, 0),
  ]
  const excluded = (t: Transaction): Transaction => ({ ...t, tags: ['vat'], excluded: true })

  it('Cash Flow and P&L count the excluded operations only with includeExcluded', () => {
    const txs = [
      excluded(tx('income', 230, '2026-10-20T10:00:00Z')),
      excluded(tx('expense', 230, '2026-10-20T11:00:00Z')),
      tx('income', 1000, '2026-10-21T10:00:00Z', 'cat-in'),
    ]
    expect(totals(buildCashFlow(sel(txs), period, 'uk'))).toEqual([1000, 0])
    expect(totals(buildCashFlow(sel(txs, true), period, 'uk'))).toEqual([1230, 230])
    const cats = [category('cat-in', 'income', 'Sprzedaż')]
    const rows = (includeExcluded = false) => buildPL(sel(txs, includeExcluded), cats, period, NONE).rows.map((r) => [r.categoryId, r.total])
    expect(rows()).toEqual([['cat-in', 1000]])
    expect(rows(true)).toEqual([
      ['cat-in', 1000],
      ['__uncategorized_income', 230],
      ['__uncategorized_expense', 230],
    ])
  })

  it('the Calendar leaves the excluded operations out too, also from the balance carried in (the S10t gap)', () => {
    const txs = [
      excluded(tx('income', 500, '2026-09-10T12:00:00Z')),
      tx('income', 100, '2026-09-11T12:00:00Z'),
      excluded(tx('income', 230, '2026-10-20T10:00:00Z')),
      excluded(tx('expense', 230, '2026-10-20T11:00:00Z')),
      tx('expense', 40, '2026-10-21T12:00:00Z'),
    ]
    const { days } = buildCalendar(sel(txs), 2026, 9)
    expect(days.reduce((s, d) => s + d.income, 0)).toBe(0)
    expect(days.reduce((s, d) => s + d.expense, 0)).toBe(40)
    expect(days[19]).toMatchObject({ date: '2026-10-20', income: 0, expense: 0, hasTransactions: false, balance: 100 })
    expect(days[30].balance).toBe(60)
    const { days: all } = buildCalendar(sel(txs, true), 2026, 9)
    expect(all[19]).toMatchObject({ income: 230, expense: 230, hasTransactions: true, balance: 600 })
    expect(all[30].balance).toBe(560)
  })

  it('with a filter the totals are the sums of the operations it chose (the data of the e2e)', () => {
    const at = (t: Transaction, over: Partial<Transaction>): Transaction => ({ ...t, ...over })
    const txs = [
      at(tx('income', 500, '2026-10-02T10:00:00Z', 'cat-in'), { accountId: 'main' }),
      at(tx('expense', 120, '2026-10-05T10:00:00Z', 'cat-ex'), { accountId: 'main' }),
      at(tx('expense', 40, '2026-10-06T10:00:00Z', 'cat-ex'), { accountId: 'main', tags: ['fuel'] }),
      at(tx('expense', 230, '2026-10-07T10:00:00Z'), { accountId: 'main', tags: ['vat'], excluded: true }),
      at(tx('income', 230, '2026-10-07T10:00:00Z'), { accountId: 'vat', tags: ['vat'], excluded: true }),
      at(tx('expense', 15, '2026-10-08T10:00:00Z', 'cat-ex'), { accountId: 'vat' }),
      at(tx('transfer', 300, '2026-10-09T10:00:00Z'), { accountId: 'main', toAccountId: 'vat' }),
    ]
    const cats = [category('cat-in', 'income', 'Sprzedaż'), category('cat-ex', 'expense', 'Koszty')]
    const cases: [Partial<AnalyticsFilters>, [number, number]][] = [
      [{}, [500, 175]],
      [{ tagIds: ['vat'] }, [230, 230]],
      [{ tagIds: [NO_TAG] }, [500, 135]],
      [{ accountIds: ['vat'] }, [0, 15]],
      [{ types: ['expense'], categoryIds: ['cat-ex'] }, [0, 175]],
      [{ types: ['income'] }, [500, 0]],
      [{ types: ['income'], categoryIds: ['cat-ex'] }, [500, 175]],
    ]
    for (const [choice, expected] of cases) {
      const selection = filterForAnalytics(txs, { ...EMPTY_ANALYTICS_FILTERS, ...choice })
      const counted = selection.operations.filter((t) => t.type !== 'transfer' && (selection.includeExcluded || t.excluded !== true))
      const sum = (type: 'income' | 'expense') => counted.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0)
      const label = JSON.stringify(choice)
      expect([sum('income'), sum('expense')], label).toEqual(expected)
      expect(totals(buildCashFlow(selection, period, 'uk')), label).toEqual(expected)
      const pl = buildPL(selection, cats, period, NONE)
      const plSum = (type: 'income' | 'expense') => pl.rows.filter((r) => r.type === type).reduce((s, r) => s + r.total, 0)
      expect([plSum('income'), plSum('expense')], label).toEqual(expected)
    }
  })
})

describe('excludedCounted: whether a report counted an excluded operation (the hint, S10f)', () => {
  const october = resolvePeriod({ preset: 'currentMonth' }, NOW)
  const NONE = 'Bez kategorii'
  const excluded = (t: Transaction): Transaction => ({ ...t, tags: ['vat'], excluded: true })

  it('Cash Flow: an excluded operation outside the period is not counted', () => {
    const txs = [excluded(tx('income', 230, '2026-09-20T10:00:00Z')), tx('income', 1000, '2026-10-21T10:00:00Z', 'cat-in')]
    expect(buildCashFlow(sel(txs, true), october, 'uk').excludedCounted).toBe(false)
  })

  it('an excluded transfer is not counted: transfers never count in Cash Flow, P&L or the Calendar', () => {
    const txs = [excluded(tx('transfer', 230, '2026-10-20T10:00:00Z'))]
    expect(buildCashFlow(sel(txs, true), october, 'uk').excludedCounted).toBe(false)
    expect(buildPL(sel(txs, true), [], october, NONE).excludedCounted).toBe(false)
    expect(buildCalendar(sel(txs, true), 2026, 9).excludedCounted).toBe(false)
  })

  it('an excluded operation in the period is counted only with a concrete tag (includeExcluded)', () => {
    const txs = [excluded(tx('income', 230, '2026-10-20T10:00:00Z')), tx('expense', 40, '2026-10-21T10:00:00Z')]
    expect(buildCashFlow(sel(txs, true), october, 'uk').excludedCounted).toBe(true)
    expect(buildCashFlow(sel(txs), october, 'uk').excludedCounted).toBe(false)
    expect(buildPL(sel(txs, true), [], october, NONE).excludedCounted).toBe(true)
    expect(buildPL(sel(txs), [], october, NONE).excludedCounted).toBe(false)
    expect(buildCalendar(sel(txs, true), 2026, 9).excludedCounted).toBe(true)
    expect(buildCalendar(sel(txs), 2026, 9).excludedCounted).toBe(false)
  })

  it('the Calendar says so for the visible month only, or for a balance carried in from an earlier month', () => {
    const txs = [excluded(tx('expense', 230, '2026-10-20T10:00:00Z'))]
    expect(buildCalendar(sel(txs, true), 2026, 8).excludedCounted).toBe(false) // September: nothing shown
    expect(buildCalendar(sel(txs, true), 2026, 9).excludedCounted).toBe(true) // October: the day
    expect(buildCalendar(sel(txs, true), 2026, 10).excludedCounted).toBe(true) // November: the balance carried in
  })
})
