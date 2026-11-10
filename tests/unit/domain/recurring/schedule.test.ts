import { describe, expect, it } from 'vitest'
import {
  addMonthsClamped,
  daysInMonth,
  isoWeekday,
  nextOccurrenceAfter,
  occurrencesBetween,
  paymentDayOf,
  periodOf,
  periodStart,
  windowEnd,
} from '@/lib/domain/recurring/schedule'
import type { Schedule } from '@/lib/domain/recurring/types'

const monthly = (dayOfMonth: number, startDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'monthly', interval: 1, dayOfMonth, weekday: null, startDate, weekendRule: 'none', ...extra,
})
const weekly = (weekday: number, startDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'weekly', interval: 1, dayOfMonth: null, weekday, startDate, weekendRule: 'none', ...extra,
})
const quarterly: Schedule = { frequency: 'everyNMonths', interval: 3, dayOfMonth: 10, weekday: null, startDate: '2026-01-10', weekendRule: 'none' }

describe('month arithmetic', () => {
  it('knows the length of a month, February of a leap year too', () => {
    expect(daysInMonth(2027, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 11)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('adds months and takes the last day of a shorter month', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2027-12-15', 1)).toBe('2028-01-15')
    expect(addMonthsClamped('2027-11-29', 3)).toBe('2028-02-29')
  })

  it('the window reaches three months ahead', () => {
    expect(windowEnd('2026-11-10')).toBe('2027-02-10')
    expect(windowEnd('2026-11-30')).toBe('2027-02-28')
  })

  it('numbers the weekdays from Monday', () => {
    expect(isoWeekday('2026-11-16')).toBe(1)
    expect(isoWeekday('2026-11-10')).toBe(2)
    expect(isoWeekday('2026-11-15')).toBe(7)
  })
})

describe('occurrencesBetween', () => {
  it('the 31st falls on the last day of shorter months (28 or 29 February)', () => {
    expect(occurrencesBetween(monthly(31, '2026-12-01'), '2026-12-01', '2027-04-30')).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    ])
    expect(occurrencesBetween(monthly(31, '2028-01-01'), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29'])
  })

  it('starts with the first rule day on or after the start', () => {
    expect(occurrencesBetween(monthly(15, '2026-11-20'), '2026-11-01', '2027-01-31')).toEqual(['2026-12-15', '2027-01-15'])
    expect(occurrencesBetween(monthly(15, '2026-11-15'), '2026-11-01', '2026-12-31')).toEqual(['2026-11-15', '2026-12-15'])
  })

  it('lists only the days inside the range, both ends included', () => {
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-11-10', '2027-02-10')).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'])
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-11-11', '2026-12-09')).toEqual([])
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-12-01', '2026-11-01')).toEqual([])
  })

  it('stops at the end day, which counts', () => {
    expect(occurrencesBetween(monthly(15, '2026-11-01', { endDate: '2027-01-15' }), '2026-11-01', '2027-06-30')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
    expect(occurrencesBetween(monthly(15, '2026-11-01', { endDate: '2027-01-14' }), '2026-11-01', '2027-06-30')).toEqual(['2026-11-15', '2026-12-15'])
  })

  it('a weekly series takes its weekday every seven days', () => {
    expect(occurrencesBetween(weekly(1, '2026-11-10'), '2026-11-10', '2026-12-01')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30'])
    expect(occurrencesBetween(weekly(2, '2026-11-10'), '2026-11-10', '2026-11-24')).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
    expect(occurrencesBetween(weekly(1, '2026-01-05'), '2026-11-17', '2026-12-01')).toEqual(['2026-11-23', '2026-11-30'])
  })

  it('every N months keeps the phase of the start month', () => {
    expect(occurrencesBetween(quarterly, '2026-01-01', '2026-12-31')).toEqual(['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10'])
    expect(occurrencesBetween(quarterly, '2026-05-01', '2027-01-31')).toEqual(['2026-07-10', '2026-10-10', '2027-01-10'])
    expect(occurrencesBetween({ ...quarterly, startDate: '2026-01-20' }, '2026-01-01', '2026-07-31')).toEqual(['2026-04-10', '2026-07-10'])
  })

  it('a yearly series repeats the month of its start; 29 February becomes 28 in other years', () => {
    const yearly: Schedule = { frequency: 'yearly', interval: 1, dayOfMonth: 29, weekday: null, startDate: '2024-02-29', weekendRule: 'none' }
    expect(occurrencesBetween(yearly, '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('does not move with the summer time change: days are calendar days', () => {
    // Poland: the clocks go forward on 2027-03-28 and back on 2026-10-25.
    expect(occurrencesBetween(weekly(1, '2027-03-15'), '2027-03-15', '2027-04-05')).toEqual(['2027-03-15', '2027-03-22', '2027-03-29', '2027-04-05'])
    expect(occurrencesBetween(monthly(25, '2026-09-01'), '2026-09-01', '2026-11-30')).toEqual(['2026-09-25', '2026-10-25', '2026-11-25'])
  })
})

describe('paymentDayOf (Polish business days)', () => {
  it('keeps a business day, and every day without a rule', () => {
    expect(paymentDayOf('2026-11-16', 'next')).toBe('2026-11-16')
    expect(paymentDayOf('2026-11-15', 'none')).toBe('2026-11-15')
  })

  it('moves a weekend to the next or the previous business day', () => {
    expect(paymentDayOf('2026-11-15', 'next')).toBe('2026-11-16')
    expect(paymentDayOf('2026-11-15', 'previous')).toBe('2026-11-13')
  })

  it('skips holidays: 11 November, Christmas Eve and Christmas, Easter Monday', () => {
    expect(paymentDayOf('2026-11-11', 'next')).toBe('2026-11-12')
    expect(paymentDayOf('2026-12-25', 'next')).toBe('2026-12-28')
    expect(paymentDayOf('2026-12-26', 'previous')).toBe('2026-12-23')
    // Easter Sunday 2027 is 28 March, the day the clocks go forward; Easter Monday is a holiday too.
    expect(paymentDayOf('2027-03-28', 'next')).toBe('2027-03-30')
  })

  it('the clocks going back on 25 October 2026 do not shift the day', () => {
    expect(paymentDayOf('2026-10-25', 'next')).toBe('2026-10-26')
  })
})

describe('periods', () => {
  it('an occurrence stands for its week, month, block of N months or year', () => {
    expect(periodOf(weekly(1, '2026-01-05'), '2026-11-18')).toBe('2026-11-16')
    expect(periodOf(monthly(10, '2026-01-10'), '2026-11-20')).toBe('2026-11')
    expect(periodOf({ ...quarterly, frequency: 'yearly' }, '2026-11-20')).toBe('2026')
    expect(periodOf(quarterly, '2026-05-02')).toBe('1')
    expect(periodOf(quarterly, '2026-03-31')).toBe('0')
  })

  it('the first day of the period a day is in', () => {
    expect(periodStart(weekly(1, '2026-01-05'), '2026-11-18')).toBe('2026-11-16')
    expect(periodStart(monthly(10, '2026-01-10'), '2026-11-20')).toBe('2026-11-01')
    expect(periodStart({ ...quarterly, frequency: 'yearly' }, '2026-11-20')).toBe('2026-01-01')
    expect(periodStart(quarterly, '2026-05-02')).toBe('2026-04-01')
  })
})

describe('nextOccurrenceAfter', () => {
  it('is the first occurrence strictly after the day, or null once the series ended', () => {
    expect(nextOccurrenceAfter(monthly(15, '2026-01-15'), '2026-11-15')).toBe('2026-12-15')
    expect(nextOccurrenceAfter(monthly(15, '2026-01-15', { endDate: '2026-11-30' }), '2026-11-15')).toBeNull()
    const biennial: Schedule = { frequency: 'everyNMonths', interval: 24, dayOfMonth: 1, weekday: null, startDate: '2026-01-01', weekendRule: 'none' }
    expect(nextOccurrenceAfter(biennial, '2026-01-01')).toBe('2028-01-01')
  })
})
