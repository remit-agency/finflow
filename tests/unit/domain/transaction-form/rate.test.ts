import { describe, expect, it } from 'vitest'
import { convertApprox, formatRate, rateLine } from '@/lib/domain/transaction-form/rate'

describe('rateLine', () => {
  it('names the stronger currency as the base: 440 PLN → 100 EUR is 1 EUR = 4.4 PLN', () => {
    expect(rateLine(440, 'PLN', 100, 'EUR')).toEqual({ base: 'EUR', quote: 'PLN', value: 4.4 })
  })

  it('gives the same line for the opposite direction', () => {
    expect(rateLine(100, 'EUR', 440, 'PLN')).toEqual({ base: 'EUR', quote: 'PLN', value: 4.4 })
  })

  it('is null while an amount is missing or not positive', () => {
    expect(rateLine(0, 'PLN', 100, 'EUR')).toBeNull()
    expect(rateLine(440, 'PLN', 0, 'EUR')).toBeNull()
    expect(rateLine(Number.NaN, 'PLN', 100, 'EUR')).toBeNull()
  })
})

describe('convertApprox', () => {
  it('rounds the converted amount to 2 decimals', () => {
    expect(convertApprox(100, 4.2531)).toBe(425.31)
    expect(convertApprox(10.05, 4.5)).toBe(45.23)
  })
})

describe('formatRate', () => {
  it('shows at least 4 and at most 6 decimals in the UI locale', () => {
    expect(formatRate(4.4, 'en')).toBe('4.4000')
    expect(formatRate(4.123456789, 'en')).toBe('4.123457')
    expect(formatRate(4.4, 'pl')).toBe('4,4000')
  })
})
