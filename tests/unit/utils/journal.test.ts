import { describe, expect, it } from 'vitest'
import { formatDayShortUtc, formatWeekdayShortUtc, isListed, summarizeDay } from '@/lib/utils/journal'

const tx = (
  type: 'income' | 'expense' | 'transfer',
  amount: number,
  currency = 'UAH',
  status: 'actual' | 'planned' = 'actual',
) => ({ type, amount, currency, status })

describe('formatDayShortUtc', () => {
  // The journal groups by the UTC day (toISOString), so a row must read the same UTC day
  // whatever the browser's time zone is (run with TZ=America/Los_Angeles to check).
  it('reads the UTC day for a date at the start of the UTC day', () => {
    expect(formatDayShortUtc(new Date('2026-10-23T00:00:00Z'), 'uk')).toBe('23 жовт.')
  })

  it('reads the UTC day for a date at the end of the UTC day', () => {
    expect(formatDayShortUtc(new Date('2026-10-23T23:59:59Z'), 'uk')).toBe('23 жовт.')
  })

  it('agrees with the group key', () => {
    const date = new Date('2026-01-05T01:00:00Z')
    expect(date.toISOString().split('T')[0]).toBe('2026-01-05')
    expect(formatDayShortUtc(date, 'uk')).toBe('5 січ.')
  })

  it('follows the UI language', () => {
    const date = new Date('2026-10-23T00:00:00Z')
    expect(formatDayShortUtc(date, 'pl')).toBe('23 paź')
    expect(formatDayShortUtc(date, 'en')).toBe('23 Oct')
  })
})

describe('formatWeekdayShortUtc', () => {
  it('reads the UTC weekday at both ends of the UTC day', () => {
    // 2026-10-23 is a Friday.
    expect(formatWeekdayShortUtc(new Date('2026-10-23T00:00:00Z'), 'uk')).toBe('пт')
    expect(formatWeekdayShortUtc(new Date('2026-10-23T23:59:59Z'), 'uk')).toBe('пт')
  })

  it('follows the UI language', () => {
    const date = new Date('2026-10-23T12:00:00Z')
    expect(formatWeekdayShortUtc(date, 'pl')).toBe('pt.')
    expect(formatWeekdayShortUtc(date, 'en')).toBe('Fri')
  })
})

describe('summarizeDay', () => {
  it('sums income minus expense in the shared currency', () => {
    expect(summarizeDay([tx('income', 1000), tx('expense', 250.5)])).toEqual({ total: 749.5, currency: 'UAH' })
  })

  it('gives a negative total for an expense-only day', () => {
    expect(summarizeDay([tx('expense', 300)])).toEqual({ total: -300, currency: 'UAH' })
  })

  it('gives exactly zero for a transfer-only day', () => {
    expect(summarizeDay([tx('transfer', 5000, 'PLN')])).toEqual({ total: 0, currency: 'PLN' })
  })

  it('ignores transfers when it sums', () => {
    expect(summarizeDay([tx('income', 100), tx('transfer', 5000)])).toEqual({ total: 100, currency: 'UAH' })
  })

  it('rounds away floating point noise to cents', () => {
    expect(summarizeDay([tx('income', 0.1), tx('income', 0.2), tx('expense', 0.3)])).toEqual({
      total: 0,
      currency: 'UAH',
    })
  })

  it('omits the total when income and expense use different currencies', () => {
    expect(summarizeDay([tx('income', 100, 'UAH'), tx('expense', 5, 'USD')])).toBeNull()
  })

  it('omits the total for several non-transfer currencies even if they cancel out', () => {
    expect(summarizeDay([tx('income', 5, 'USD'), tx('income', 5, 'EUR')])).toBeNull()
  })

  it('does not let a transfer in another currency spoil the total', () => {
    expect(summarizeDay([tx('income', 100, 'UAH'), tx('transfer', 10, 'USD')])).toEqual({
      total: 100,
      currency: 'UAH',
    })
  })

  it('gives null for no transactions', () => {
    expect(summarizeDay([])).toBeNull()
  })

  it('does not count planned operations in the sum of the day', () => {
    expect(summarizeDay([tx('income', 1000), { ...tx('expense', 400), status: 'planned' }])).toEqual({ total: 1000, currency: 'UAH' })
  })

  it('has no sum for a day that holds only planned operations', () => {
    expect(summarizeDay([{ ...tx('expense', 400), status: 'planned' }])).toBeNull()
  })
})

describe('isListed', () => {
  it('actual operations are always listed', () => {
    expect(isListed({ status: 'actual' }, false)).toBe(true)
  })
  it('planned ones only when the journal asks for them', () => {
    expect(isListed({ status: 'planned' }, false)).toBe(false)
    expect(isListed({ status: 'planned' }, true)).toBe(true)
  })
})
