import { describe, expect, it } from 'vitest'
import { buildCashFlow, buildPL } from '@/lib/utils/analytics'
import { resolvePeriod } from '@/lib/utils/period'
import type { Category, Transaction } from '@/types'
import { makeTx } from '../helpers/fixtures'

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
    const report = buildCashFlow(txs, resolvePeriod({ preset: 'currentWeek' }, NOW), 'uk')
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
    const report = buildCashFlow(txs, resolvePeriod({ preset: 'currentYear' }, NOW), 'uk')
    expect(report.granularity).toBe('month')
    expect(report.buckets).toHaveLength(12)
    expect(report.buckets[0]).toMatchObject({ key: '2026-01', label: 'Січ 26', income: 300, net: 300, balance: 300 })
    expect(report.buckets[2]).toMatchObject({ key: '2026-03', expense: 100, net: -100, balance: 200 })
    expect(report.buckets[11]).toMatchObject({ key: '2026-12', label: 'Гру 26', income: 50, balance: 250 })
  })

  it('previous year shows only last year', () => {
    const txs = [tx('income', 500, '2025-06-15T12:00:00Z'), tx('income', 300, '2026-10-23T08:00:00Z')]
    const report = buildCashFlow(txs, resolvePeriod({ preset: 'prevYear' }, NOW), 'uk')
    expect(report.buckets[0].key).toBe('2025-01')
    expect(report.buckets.reduce((s, b) => s + b.income, 0)).toBe(500)
  })

  it('buckets by the UTC day: 23:30 UTC stays on its UTC day', () => {
    const txs = [tx('income', 10, '2026-10-20T23:30:00Z')]
    const report = buildCashFlow(txs, resolvePeriod({ preset: 'currentWeek' }, NOW), 'uk')
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
    const report = buildCashFlow(txs, range, 'uk')
    expect(report.granularity).toBe('month')
    expect(report.buckets.map((b) => [b.key, b.income])).toEqual([['2026-03', 20], ['2026-04', 300]])
  })

  it('31 days are still days, 32 days are months', () => {
    const at = (iso: string) => new Date(`${iso}T00:00:00Z`)
    const days31 = resolvePeriod({ preset: 'custom', start: at('2026-01-01'), end: at('2026-01-31') }, NOW)
    const days32 = resolvePeriod({ preset: 'custom', start: at('2026-01-01'), end: at('2026-02-01') }, NOW)
    expect(buildCashFlow([], days31, 'uk')).toMatchObject({ granularity: 'day' })
    expect(buildCashFlow([], days31, 'uk').buckets).toHaveLength(31)
    expect(buildCashFlow([], days32, 'uk').granularity).toBe('month')
    expect(buildCashFlow([], days32, 'uk').buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02'])
  })

  it('current month (31 days) is bucketed by day', () => {
    const report = buildCashFlow([], resolvePeriod({ preset: 'currentMonth' }, NOW), 'uk')
    expect(report.granularity).toBe('day')
    expect(report.buckets).toHaveLength(31)
    expect(report.buckets[30].label).toBe('31 жов')
  })

  it('labels follow the UI language: the first three letters of the month name', () => {
    const year = resolvePeriod({ preset: 'currentYear' }, NOW)
    const month = (locale: 'uk' | 'pl' | 'en') => buildCashFlow([], year, locale).buckets.map((b) => b.label)
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
      buildCashFlow([], resolvePeriod({ preset: 'currentMonth' }, NOW), locale).buckets[18].label
    expect([day('uk'), day('pl'), day('en')]).toEqual(['19 жов', '19 paź', '19 Oct'])
  })

  it('all time spans the transactions; nothing to show without transactions', () => {
    const all = resolvePeriod({ preset: 'allTime' }, NOW)
    expect(buildCashFlow([], all, 'uk')).toEqual({ granularity: 'month', buckets: [] })
    const report = buildCashFlow(
      [tx('income', 10, '2025-11-03T10:00:00Z'), tx('expense', 4, '2026-01-20T10:00:00Z')],
      all,
      'uk',
    )
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
    const { monthKeys, rows } = buildPL(txs, categories, resolvePeriod({ preset: 'currentWeek' }, NOW), NONE)
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
    const { monthKeys, rows } = buildPL(txs, categories, resolvePeriod({ preset: 'currentWeek' }, new Date('2026-01-01T10:00:00Z')), NONE)
    expect(monthKeys).toEqual(['2025-12', '2026-01'])
    expect(rows[0]).toMatchObject({ total: 15, months: { '2025-12': 10, '2026-01': 5 } })
  })

  it('current year has twelve columns; a custom range only its months', () => {
    expect(buildPL([], categories, resolvePeriod({ preset: 'currentYear' }, NOW), NONE).monthKeys).toHaveLength(12)
    const custom = resolvePeriod(
      { preset: 'custom', start: new Date('2026-03-12T00:00:00Z'), end: new Date('2026-04-18T00:00:00Z') },
      NOW,
    )
    const { monthKeys, rows } = buildPL(
      [tx('expense', 25, '2026-04-18T22:00:00Z', 'rent'), tx('expense', 99, '2026-03-11T22:00:00Z', 'rent')],
      categories,
      custom,
      NONE,
    )
    expect(monthKeys).toEqual(['2026-03', '2026-04'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ categoryId: 'rent', total: 25, months: { '2026-03': 0, '2026-04': 25 } })
  })

  it('all time without transactions is empty', () => {
    expect(buildPL([], categories, resolvePeriod({ preset: 'allTime' }, NOW), NONE)).toEqual({ monthKeys: [], rows: [] })
  })

  it('names the rows with nameOf when given and with the stored name otherwise', () => {
    const range = resolvePeriod({ preset: 'currentWeek' }, NOW)
    const txs = [tx('income', 100, '2026-10-19T00:00:00Z', 'sales'), tx('expense', 40, '2026-10-20T12:00:00Z', 'rent')]
    const stored = buildPL(txs, categories, range, NONE)
    expect(stored.rows.map((r) => r.categoryName)).toEqual(['Продажі', 'Оренда'])

    const shown = buildPL(txs, categories, range, NONE, (cat) => `${cat.type}:${cat.name}`)
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
    const flow = buildCashFlow([vatIn, vatOut, sale], period, 'uk')
    expect(flow.buckets.reduce((sum, b) => sum + b.income, 0)).toBe(1000)
    expect(flow.buckets.reduce((sum, b) => sum + b.expense, 0)).toBe(0)
    const pl = buildPL([vatIn, vatOut, sale], [category('cat-in', 'income', 'Sprzedaż'), category('cat-ex', 'expense', 'Koszty')], period, 'Bez kategorii')
    expect(pl.rows.map((r) => [r.categoryId, r.total])).toEqual([['cat-in', 1000]])
  })
})
