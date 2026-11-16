import { describe, expect, it } from 'vitest'
import { buildCalendarMonth, monthRange, type CalendarInput } from '@/lib/domain/forecast/calendar'
import { buildForecast } from '@/lib/domain/forecast/build'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-16'
const row = (id: string, paymentDate: string, amountMinor: number, type: PlannedRow['type'] = 'expense'): PlannedRow => ({
  id,
  type,
  accountId: 'a1',
  amountMinor,
  currency: 'PLN',
  paymentDate,
  estimated: false,
  manual: false,
})

function input(over: Partial<CalendarInput> = {}): CalendarInput {
  const planned = [row('p1', '2026-11-18', 30_000), row('late', '2026-11-10', 5_000)]
  const forecast = buildForecast({ today: TODAY, baseCurrency: 'PLN', minimumMinor: 80_000, startBase: 100_000, startIncomplete: false, foreignAccounts: false, planned, rates: new Map(), names: {}, truncated: false })
  return {
    year: 2026,
    month: 11,
    today: TODAY,
    currency: 'PLN',
    movement: new Map([['2026-11-02', { incomeBase: 70_000, expenseBase: 20_000 }]]),
    planned,
    rates: new Map(),
    pastBalances: new Map([['2026-11-02', 90_000], ['2026-11-15', null]]),
    forecast,
    ...over,
  }
}

describe('monthRange', () => {
  it('gives the first and the last day of a month, leap years included', () => {
    expect(monthRange(2026, 11)).toEqual({ first: '2026-11-01', last: '2026-11-30' })
    expect(monthRange(2028, 2)).toEqual({ first: '2028-02-01', last: '2028-02-29' })
  })
})

describe('buildCalendarMonth', () => {
  it('has one entry per day of the month and tells past, today and future apart', () => {
    const m = buildCalendarMonth(input())
    expect(m.days).toHaveLength(30)
    expect(m.days[0].date).toBe('2026-11-01')
    expect(m.days[15]).toMatchObject({ date: '2026-11-16', kind: 'today' })
    expect(m.days[14].kind).toBe('past')
    expect(m.days[16].kind).toBe('future')
  })

  it('shows what happened, what is planned and the overdue count by day', () => {
    const m = buildCalendarMonth(input())
    expect(m.days[1]).toMatchObject({ incomeBase: 70_000, expenseBase: 20_000, plannedExpenseBase: 0 })
    expect(m.days[17]).toMatchObject({ date: '2026-11-18', plannedExpenseBase: 30_000, overdueCount: 0 })
    expect(m.days[9]).toMatchObject({ date: '2026-11-10', plannedExpenseBase: 5_000, overdueCount: 1 })
  })

  it('past days show the real balance (null when it is not valued), today and later the forecast', () => {
    const m = buildCalendarMonth(input())
    expect(m.days[1].endBalanceBase).toBe(90_000)
    expect(m.days[14].endBalanceBase).toBeNull()
    expect(m.days[15].endBalanceBase).toBe(95_000)
    expect(m.days[17].endBalanceBase).toBe(65_000)
  })

  it('marks the days below the minimum and the first one as the gap', () => {
    const m = buildCalendarMonth(input())
    expect(m.gapDate).toBe('2026-11-18')
    expect(m.days[17]).toMatchObject({ belowMinimum: true, gap: true })
    expect(m.days[18]).toMatchObject({ belowMinimum: true, gap: false })
    expect(m.days[15]).toMatchObject({ belowMinimum: false, gap: false })
  })

  it('a month past the forecast horizon has planned amounts but no balance', () => {
    const m = buildCalendarMonth(input({ year: 2027, month: 6, movement: new Map(), planned: [row('far', '2027-06-10', 12_000)], pastBalances: new Map() }))
    expect(m.days).toHaveLength(30)
    expect(m.days[9]).toMatchObject({ date: '2027-06-10', kind: 'future', plannedExpenseBase: 12_000, endBalanceBase: null, belowMinimum: false })
  })

  it('leaves transfers out', () => {
    const m = buildCalendarMonth(input({ planned: [row('t', '2026-11-18', 90_000, 'transfer')] }))
    expect(m.days[17].plannedExpenseBase).toBe(0)
    expect(m.unvalued).toBe(0)
  })

  it('does not count a payment inside the forecast window twice: the forecast already counts it as unvalued', () => {
    const planned = [{ ...row('e', '2026-11-18', 1_000), currency: 'EUR' }]
    const forecast = buildForecast({ today: TODAY, baseCurrency: 'PLN', minimumMinor: 80_000, startBase: 100_000, startIncomplete: false, foreignAccounts: false, planned, rates: new Map(), names: {}, truncated: false })
    expect(forecast.unvalued).toBe(1)
    const m = buildCalendarMonth(input({ planned, forecast }))
    expect(m.unvalued).toBe(1)
  })

  it('a payment without a rate beyond the forecast window is unvalued and makes a valued foreign one approximate', () => {
    const m = buildCalendarMonth(input({ year: 2027, month: 6, movement: new Map(), pastBalances: new Map(), planned: [{ ...row('far', '2027-06-10', 12_000), currency: 'EUR' }] }))
    expect(m.unvalued).toBe(input().forecast.unvalued + 1)
    expect(m.approximate).toBe(input().forecast.approximate)
    const valued = buildCalendarMonth(input({ year: 2027, month: 6, movement: new Map(), pastBalances: new Map(), planned: [{ ...row('far', '2027-06-10', 12_000), currency: 'EUR' }], rates: new Map([['EUR', 4.5]]) }))
    expect(valued.approximate).toBe(true)
    expect(valued.unvalued).toBe(0)
  })
})
