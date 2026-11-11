import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import type { AccountMovement, BalancesReport } from '@/lib/domain/reports/types'
import {
  AS_OF_OPTIONS,
  asOfDay,
  balanceSheetLines,
  cashFlowBuckets,
  inShellOrder,
  openRowGap,
  periodKeyLabel,
  plRows,
  reportQueryOf,
} from '@/lib/utils/report-view'
import type { Category } from '@/types'
import { sampleCashFlow, samplePL } from '../domain/reports/fixtures'

describe('periodKeyLabel', () => {
  it('a month key as a month label, a day key as a day label, in the UI language', () => {
    expect(periodKeyLabel('2026-10', 'uk')).toBe('Жов 26')
    expect(periodKeyLabel('2026-10', 'en')).toBe('Oct 2026')
    expect(periodKeyLabel('2026-10-19', 'pl')).toBe('19 paź')
    expect(periodKeyLabel('2026-10-19', 'en')).toBe('19 Oct')
  })
})

describe('reportQueryOf', () => {
  it('the period of the toolbar as UTC days, with the filters of the address', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    expect(reportQueryOf({ preset: 'currentYear' }, now, EMPTY_ANALYTICS_FILTERS)).toEqual({ from: '2026-01-01', to: '2026-12-31', filters: EMPTY_ANALYTICS_FILTERS })
    expect(reportQueryOf({ preset: 'prevMonth' }, now, EMPTY_ANALYTICS_FILTERS)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(reportQueryOf({ preset: 'currentWeek' }, now, EMPTY_ANALYTICS_FILTERS)).toMatchObject({ from: '2026-11-09', to: '2026-11-15' })
    expect(() => reportQueryOf({ preset: 'allTime' }, now, EMPTY_ANALYTICS_FILTERS)).toThrow(RangeError)
  })
})

describe('cashFlowBuckets', () => {
  it('the server buckets in major units with the labels of the UI language', () => {
    expect(cashFlowBuckets(sampleCashFlow(), 'uk')).toEqual([
      { key: '2026-10-01', label: '1 жов', income: 500, expense: 120, net: 380, balance: 380 },
      { key: '2026-10-02', label: '2 жов', income: 0, expense: 40.5, net: -40.5, balance: 339.5 },
    ])
  })
})

describe('plRows', () => {
  it('rows in the order of the categories, the uncategorised row after them, names from the page, values per month', () => {
    const categories: Category[] = [
      { id: 'cat-in', orgId: 'o', name: 'Sprzedaż', type: 'income', color: '#000000' },
      { id: 'cat-it', orgId: 'o', name: 'IT', type: 'expense', color: '#000000' },
    ]
    const { monthKeys, rows } = plRows(samplePL(), categories, (c) => `«${c.name}»`, 'Bez kategorii')
    expect(monthKeys).toEqual(['2026-09', '2026-10'])
    expect(rows).toEqual([
      { categoryId: 'cat-in', categoryName: '«Sprzedaż»', type: 'income', months: { '2026-09': 0, '2026-10': 500 }, total: 500 },
      { categoryId: 'cat-it', categoryName: '«IT»', type: 'expense', months: { '2026-09': 0, '2026-10': 120 }, total: 120 },
      { categoryId: '_none:expense', categoryName: 'Bez kategorii', type: 'expense', months: { '2026-09': 10, '2026-10': 20 }, total: 30 },
    ])
  })
})

describe('asOfDay', () => {
  it('today and the ends of the last month, quarter and year', () => {
    expect(AS_OF_OPTIONS.map((o) => asOfDay(o, '2026-11-11'))).toEqual(['2026-11-11', '2026-10-31', '2026-09-30', '2025-12-31'])
    expect(asOfDay('prevMonthEnd', '2026-03-05')).toBe('2026-02-28')
    expect(asOfDay('prevQuarterEnd', '2026-01-15')).toBe('2025-12-31')
    expect(asOfDay('prevQuarterEnd', '2026-04-01')).toBe('2026-03-31')
  })
})

describe('balanceSheetLines and inShellOrder', () => {
  it('the server balances in the order of the sidebar, in major units; accounts the sidebar does not know come last', () => {
    const report: BalancesReport = {
      date: '2026-10-27', currency: 'PLN', totalBase: 182_000, complete: true, byCurrency: [],
      accounts: [
        { accountId: 'eur', name: 'EUR', type: 'bank', currency: 'EUR', color: '#111111', balanceMinor: 25_000, baseMinor: 110_000 },
        { accountId: 'new', name: 'New', type: 'cash', currency: 'PLN', color: '#222222', balanceMinor: 0, baseMinor: 0 },
        { accountId: 'pln', name: 'PLN', type: 'bank', currency: 'PLN', color: '#333333', balanceMinor: 72_000, baseMinor: 72_000 },
      ],
    }
    expect(balanceSheetLines(report, [{ id: 'pln' }, { id: 'eur' }]).map((l) => [l.id, l.balance, l.base, l.balanceMinor])).toEqual([
      ['pln', 720, 720, 72_000],
      ['eur', 250, 1100, 25_000],
      ['new', 0, 0, 0],
    ])
    expect(inShellOrder([{ accountId: 'b' }, { accountId: 'a' }], [{ id: 'a' }, { id: 'b' }]).map((l) => l.accountId)).toEqual(['a', 'b'])
  })

  it('openRowGap is the gap of a row with balances that does not close, null when it closes or shows no balances', () => {
    const row = (over: Partial<AccountMovement>): AccountMovement => ({
      accountId: 'a', inMinor: 0, outMinor: 0, transferInMinor: 0, transferOutMinor: 0, excludedNetMinor: 0, openingMinor: 100, closingMinor: 100, ...over,
    })
    expect(openRowGap(row({ inMinor: 50, closingMinor: 150 }))).toBeNull()
    expect(openRowGap(row({ inMinor: 50, closingMinor: 120 }))).toBe(-30)
    expect(openRowGap(row({ inMinor: 50, excludedNetMinor: -230, closingMinor: 1_050, openingMinor: 1_230 }))).toBeNull()
    expect(openRowGap(row({ inMinor: 50, openingMinor: null, closingMinor: null }))).toBeNull()
  })
})
