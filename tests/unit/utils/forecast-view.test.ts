import { describe, expect, it } from 'vitest'
import type { CalendarDay, CalendarMonth } from '@/lib/domain/forecast/types'
import { chartPoints, gapDayLabel, wholeUnits } from '@/lib/utils/forecast-view'

function day(date: string, over: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date,
    kind: 'future',
    incomeBase: 0,
    expenseBase: 0,
    plannedIncomeBase: 0,
    plannedExpenseBase: 0,
    overdueCount: 0,
    endBalanceBase: 0,
    belowMinimum: false,
    gap: false,
    ...over,
  }
}

function month(days: CalendarDay[], over: Partial<CalendarMonth> = {}): CalendarMonth {
  return { year: 2026, month: 11, today: '2026-11-16', currency: 'PLN', minimumBase: 0, days, gapDate: null, approximate: false, unvalued: 0, truncated: false, ...over }
}

describe('wholeUnits', () => {
  it('rounds a major amount to whole units, half away from zero', () => {
    expect(wholeUnits(1234.6)).toBe(1235)
    expect(wholeUnits(2.5)).toBe(3)
    expect(wholeUnits(-2.5)).toBe(-3)
    expect(wholeUnits(-0.5)).toBe(-1)
  })
  it('gives +0 for an amount that rounds to zero, never -0', () => {
    expect(Object.is(wholeUnits(-0.4), 0)).toBe(true)
    expect(Object.is(wholeUnits(0.3), 0)).toBe(true)
    expect(Object.is(wholeUnits(-0), 0)).toBe(true)
  })
})

describe('gapDayLabel', () => {
  it('is the day of the month of the gap day that is shown in this month', () => {
    const days = [day('2026-11-23'), day('2026-11-24', { gap: true, belowMinimum: true })]
    expect(gapDayLabel(month(days, { gapDate: '2026-11-24' }))).toBe('24')
  })
  it('is null when the global first gap lies in another month', () => {
    const days = [day('2026-11-23'), day('2026-11-24')]
    expect(gapDayLabel(month(days, { gapDate: '2026-12-03' }))).toBeNull()
  })
  it('is null when the month has no gap day', () => {
    expect(gapDayLabel(month([day('2026-11-01')]))).toBeNull()
  })
})

describe('chartPoints', () => {
  it('draws actual days in major units and forecast from today, joining the last past day', () => {
    const days = [
      day('2026-11-14', { kind: 'past', endBalanceBase: 10050 }),
      day('2026-11-15', { kind: 'past', endBalanceBase: 20000 }),
      day('2026-11-16', { kind: 'today', endBalanceBase: 30000 }),
      day('2026-11-17', { kind: 'future', endBalanceBase: null }),
    ]
    expect(chartPoints(month(days))).toEqual([
      { label: '14', actual: 100.5, forecast: null },
      { label: '15', actual: 200, forecast: 200 },
      { label: '16', actual: null, forecast: 300 },
      { label: '17', actual: null, forecast: null },
    ])
  })
})
