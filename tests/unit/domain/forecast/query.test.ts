import { describe, expect, it } from 'vitest'
import { ReportError } from '@/lib/domain/reports/errors'
import { parseCalendarQuery, parseCashMinimum, parseDayQuery, parseMonthKey } from '@/lib/domain/forecast/query'

describe('parseMonthKey', () => {
  it('takes YYYY-MM for a month the calendar API reads (years 2000-2100)', () => {
    expect(parseMonthKey('2026-11')).toEqual({ year: 2026, month: 11 })
    expect(parseMonthKey('2000-01')).toEqual({ year: 2000, month: 1 })
    expect(parseMonthKey('2100-12')).toEqual({ year: 2100, month: 12 })
  })
  it('refuses a year the API rejects, a bad month and any other shape', () => {
    expect(parseMonthKey('1999-05')).toBeNull()
    expect(parseMonthKey('2101-01')).toBeNull()
    expect(parseMonthKey('2026-13')).toBeNull()
    expect(parseMonthKey('2026-00')).toBeNull()
    expect(parseMonthKey('2026-1')).toBeNull()
    expect(parseMonthKey('2026-11-01')).toBeNull()
    expect(parseMonthKey('')).toBeNull()
    expect(parseMonthKey(null)).toBeNull()
  })
})

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ReportError) return `${e.code}:${e.field ?? ''}`
    throw e
  }
  return 'none'
}

describe('parseCalendarQuery', () => {
  it('takes a year and a month', () => {
    expect(parseCalendarQuery(new URLSearchParams('year=2026&month=11'))).toEqual({ year: 2026, month: 11 })
  })
  it('refuses a missing, repeated or out-of-range value and unknown keys', () => {
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026')))).toBe('invalid_input:month')
    expect(code(() => parseCalendarQuery(new URLSearchParams('month=11')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=13')))).toBe('invalid_input:month')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=1999&month=1')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&year=2027&month=1')))).toBe('invalid_input:year')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=1&x=1')))).toBe('invalid_input:x')
    expect(code(() => parseCalendarQuery(new URLSearchParams('year=2026&month=1.5')))).toBe('invalid_input:month')
  })
})

describe('parseDayQuery', () => {
  it('takes one day', () => {
    expect(parseDayQuery(new URLSearchParams('date=2026-11-24'))).toBe('2026-11-24')
  })
  it('refuses a bad day or other keys', () => {
    expect(code(() => parseDayQuery(new URLSearchParams('date=2026-13-40')))).toBe('invalid_input:date')
    expect(code(() => parseDayQuery(new URLSearchParams('')))).toBe('invalid_input:date')
    expect(code(() => parseDayQuery(new URLSearchParams('date=2026-11-24&x=1')))).toBe('invalid_input:x')
  })
})

describe('parseCashMinimum', () => {
  it('is a stored whole number of minor units, else 0 (absent means 0)', () => {
    expect(parseCashMinimum(250_000)).toBe(250_000)
    expect(parseCashMinimum(undefined)).toBe(0)
    expect(parseCashMinimum(-5)).toBe(0)
    expect(parseCashMinimum(1.5)).toBe(0)
    expect(parseCashMinimum('10')).toBe(0)
  })
})
