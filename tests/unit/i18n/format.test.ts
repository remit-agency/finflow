import { describe, expect, it } from 'vitest'
import { currencySymbol, formatDate, formatMoney, formatNumber, formatWeekday, splitMoney } from '@/lib/i18n/format'

// Intl uses no-break and narrow no-break spaces; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('formats PLN by language', () => {
    expect(plain(formatMoney(12345.5, 'PLN', 'pl'))).toBe('12 345,50 zł')
    expect(plain(formatMoney(12345.5, 'PLN', 'en'))).toBe('PLN 12,345.50')
    expect(plain(formatMoney(12345.5, 'PLN', 'uk'))).toContain('12 345,50')
  })

  it('takes the currency from the argument, not from the language', () => {
    for (const locale of ['pl', 'en', 'uk'] as const) {
      // CLDR for Ukrainian has no short euro sign (ICU 78 prints the code "EUR"); pl and en print €.
      expect(plain(formatMoney(10, 'EUR', locale))).toMatch(locale === 'uk' ? /€|EUR/ : /€/)
      expect(plain(formatMoney(10, 'USD', locale))).toMatch(/\$|USD/)
    }
  })

  it('formats negatives with a sign', () => {
    expect(plain(formatMoney(-5, 'PLN', 'en'))).toMatch(/^-/)
  })
})

describe('splitMoney', () => {
  it.each(['pl', 'en', 'uk'] as const)('whole + fraction + rest is exactly formatMoney (%s)', (locale) => {
    for (const [amount, currency] of [[51450.4, 'PLN'], [-1234.56, 'EUR'], [0, 'USD']] as const) {
      const { whole, fraction, rest } = splitMoney(amount, currency, locale)
      expect(whole + fraction + rest).toBe(formatMoney(amount, currency, locale))
    }
  })

  it('has a decimal fraction for PLN', () => {
    expect(splitMoney(1.5, 'PLN', 'pl').fraction).toMatch(/^[,.]\d+$/)
  })
})

describe('formatNumber', () => {
  it('groups by language and honours options', () => {
    expect(plain(formatNumber(1234567, 'pl'))).toBe('1 234 567')
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
    expect(plain(formatNumber(12.345, 'pl', { maximumFractionDigits: 0 }))).toBe('12')
  })
})

describe('formatDate / formatWeekday', () => {
  const day = new Date(Date.UTC(2026, 3, 7)) // 7 April 2026, a Tuesday (stored dates are UTC days)

  it('formats a stored UTC day by language without shifting the day', () => {
    expect(formatDate(day, 'pl', { day: 'numeric', month: 'long' })).toBe('7 kwietnia')
    expect(formatDate(day, 'en', { day: 'numeric', month: 'long' })).toBe('7 April')
    expect(formatDate(day, 'uk', { day: 'numeric', month: 'long' })).toBe('7 квітня')
  })

  it('weekday names follow the language', () => {
    expect(formatWeekday(day, 'pl')).toMatch(/wt/i)
    expect(formatWeekday(day, 'en')).toMatch(/tue/i)
    expect(formatWeekday(day, 'uk')).toMatch(/вт/i)
  })
})

describe('currencySymbol', () => {
  it('returns the symbol of the currency', () => {
    expect(currencySymbol('EUR', 'en')).toBe('€')
    expect(currencySymbol('PLN', 'pl')).toBe('zł')
  })
})
