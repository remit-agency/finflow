import { describe, expect, it } from 'vitest'
import {
  addDays,
  compareDays,
  daysInRange,
  fromDay,
  isDay,
  isMonth,
  monthBounds,
  monthOf,
  monthsBetween,
  nextMonth,
  overlapDays,
  prevMonth,
  toDay,
} from '@/lib/domain/ledger/days'

describe('isDay', () => {
  it.each(['2026-10-26', '2024-02-29', '2002-01-02'])('accepts %s', (s) => {
    expect(isDay(s)).toBe(true)
  })
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', '26-10-26', '2026-10-26T00:00', '', ' 2026-10-26', 5, null, undefined])(
    'rejects %s',
    (s) => {
      expect(isDay(s)).toBe(false)
    },
  )
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-10-26', 366)).toBe('2027-10-27')
  })
})

describe('month helpers', () => {
  it('monthOf', () => expect(monthOf('2026-10-26')).toBe('2026-10'))
  it('prevMonth crosses the year', () => {
    expect(prevMonth('2026-01')).toBe('2025-12')
    expect(prevMonth('2026-10')).toBe('2026-09')
  })
  it('monthBounds', () => {
    expect(monthBounds('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' })
    expect(monthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' })
    expect(monthBounds('2024-02')).toEqual({ first: '2024-02-01', last: '2024-02-29' })
  })
})

describe('ledger day helpers', () => {
  it('isMonth accepts only YYYY-MM with a real month', () => {
    expect(isMonth('2026-10')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isMonth(5)).toBe(false)
  })

  it('nextMonth rolls the year', () => {
    expect(nextMonth('2026-10')).toBe('2026-11')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })

  it('monthsBetween is inclusive of both end months', () => {
    expect(monthsBetween('2026-01-15', '2026-03-02')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(monthsBetween('2026-12-31', '2027-01-01')).toEqual(['2026-12', '2027-01'])
    expect(monthsBetween('2026-05-10', '2026-05-10')).toEqual(['2026-05'])
  })

  it('daysInRange counts both ends', () => {
    expect(daysInRange('2026-02-27', '2026-03-02')).toBe(4)
    expect(daysInRange('2026-05-10', '2026-05-10')).toBe(1)
  })

  it('overlapDays counts the days of a month inside a range', () => {
    expect(overlapDays('2026-01', '2026-01-15', '2026-03-02')).toBe(17)
    expect(overlapDays('2026-02', '2026-01-15', '2026-03-02')).toBe(28)
    expect(overlapDays('2026-03', '2026-01-15', '2026-03-02')).toBe(2)
    expect(overlapDays('2026-04', '2026-01-15', '2026-03-02')).toBe(0)
  })

  it('compareDays orders day strings', () => {
    expect(compareDays('2026-01-02', '2026-01-10')).toBeLessThan(0)
    expect(compareDays('2026-01-10', '2026-01-10')).toBe(0)
  })

  it('toDay / fromDay convert between a UTC-midnight Date and a day string', () => {
    const d = fromDay('2026-10-27')
    expect(d.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(toDay(d)).toBe('2026-10-27')
  })
})
