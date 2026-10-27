import { describe, expect, it } from 'vitest'
import { LOCALES } from '@/lib/i18n/config'
import { formatAmountInput, parseAmountInput, parseSignedAmountInput, roundAmount } from '@/lib/utils/amount-input'

describe('parseAmountInput', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['1234.5', 1234.5],
    ['1234,50', 1234.5],
    ['1 234,50', 1234.5],
    ['1 234,50', 1234.5],
    ['1 234,50', 1234.5],
    ['1,234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['12,345.67', 12345.67],
    ['12.345,67', 12345.67],
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    ['1,234', 1234],
    ['1.234', 1234],
    ['12,345', 12345],
    ['0,125', 0.125],
    ['0.125', 0.125],
    ['1,2', 1.2],
    ['1,23', 1.23],
    ['1.234.567', 1234567],
    [',5', 0.5],
    ['.5', 0.5],
    ['12.', 12],
    ['12,', 12],
    ['  45 ', 45],
    ['1234567', 1234567],
  ])('parses %j as %s', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['12abc'],
    ['-5'],
    ['+5'],
    ['1e3'],
    ['Infinity'],
    ['NaN'],
    ['1,2,3'],
    ['1.2.3'],
    ['12.34.56,7'],
    [','],
    ['.'],
    ['1 2 3 a'],
    ['１２３'],
  ])('rejects %j', (input) => {
    expect(parseAmountInput(input)).toBeNull()
  })
})

describe('parseSignedAmountInput', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['1 234,50', 1234.5],
    ['1,234.50', 1234.5],
    ['-5', -5],
    ['-0,10', -0.1],
    ['-0.10', -0.1],
    ['−5', -5],
    ['−1 234,50', -1234.5],
    ['- 5', -5],
    ['  -5  ', -5],
    ['-1.234,50', -1234.5],
  ])('parses %j as %s', (input, expected) => {
    expect(parseSignedAmountInput(input)).toBe(expected)
  })

  it('reads a negative zero as 0, not -0', () => {
    expect(Object.is(parseSignedAmountInput('-0'), 0)).toBe(true)
    expect(Object.is(parseSignedAmountInput('−0,00'), 0)).toBe(true)
  })

  it.each([[''], ['   '], ['-'], ['−'], ['abc'], ['--5'], ['-−5'], ['+5'], ['5-'], ['-abc'], ['-1e3'], ['-1,2,3'], ['1-5']])(
    'rejects %j',
    (input) => {
      expect(parseSignedAmountInput(input)).toBeNull()
    },
  )

  it.each(LOCALES)('reads back what formatAmountInput prefilled a negative opening balance with in %s', (locale) => {
    for (const value of [-0.1, -1234.56, -5, 0, 7.25]) {
      expect(parseSignedAmountInput(formatAmountInput(value, locale))).toBe(value)
    }
  })
})

describe('formatAmountInput', () => {
  it.each([
    [0, 'pl', '0'],
    [0.5, 'pl', '0,5'],
    [0.5, 'uk', '0,5'],
    [0.5, 'en', '0.5'],
    [12.34, 'pl', '12,34'],
    [12.34, 'en', '12.34'],
    [1234.5, 'pl', '1234,5'],
    [1234.5, 'en', '1234.5'],
    [1234567.89, 'uk', '1234567,89'],
    [1000, 'en', '1000'],
    [0.05, 'pl', '0,05'],
    // More than 2 decimals: rounded half away from zero (documented), never read back as thousands.
    [12.345, 'pl', '12,35'],
    [12.345, 'en', '12.35'],
    [1.234, 'pl', '1,23'],
    [1.005, 'en', '1.01'],
    [0.125, 'pl', '0,13'],
    [-12.345, 'en', '-12.35'],
    // Sub-cent values are zero, not an exponent.
    [1e-7, 'pl', '0'],
    [0.004, 'en', '0'],
    [-0.001, 'en', '0'],
    // Huge values stay plain digits.
    [1e21, 'en', '1000000000000000000000'],
    // Beyond 2^53 a double has no decimals; the digits shown are its exact value, which reads back as the same double.
    [123456789012345680000, 'pl', '123456789012345683968'],
    [Number.NaN, 'pl', ''],
    [Number.POSITIVE_INFINITY, 'en', ''],
  ] as const)('formats %s for %s as %j', (value, locale, expected) => {
    expect(formatAmountInput(value, locale)).toBe(expected)
  })

  const roundTrip = [0, 0.01, 0.1, 0.5, 1, 12.34, 99.99, 1000, 1234.5, 1234.56, 9999999.99, 123456789.01]

  describe.each(LOCALES)('round trip in %s', (locale) => {
    it.each(roundTrip)('parse(format(%s)) is the same amount', (n) => {
      expect(parseAmountInput(formatAmountInput(n, locale))).toBe(n)
    })

    it('a value with more than 2 decimals comes back rounded, not scaled', () => {
      expect(parseAmountInput(formatAmountInput(12.345, locale))).toBe(12.35)
      expect(parseAmountInput(formatAmountInput(1.234, locale))).toBe(1.23)
      expect(parseAmountInput(formatAmountInput(1e-7, locale))).toBe(0)
    })

    it('a huge value is readable', () => {
      expect(parseAmountInput(formatAmountInput(1e21, locale))).toBe(1e21)
    })
  })
})

describe('roundAmount', () => {
  it.each([
    [12.345, 12.35],
    [1.005, 1.01],
    [1.234, 1.23],
    [0.125, 0.13],
    [12.34, 12.34],
    [0, 0],
    [1e-7, 0],
    [-0.001, 0],
    [1234567.891, 1234567.89],
    [1e21, 1e21],
  ])('rounds %s to %s', (value, expected) => {
    expect(roundAmount(value)).toBe(expected)
  })

  it('leaves a non-finite value alone', () => {
    expect(roundAmount(Number.NaN)).toBeNaN()
    expect(roundAmount(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })

  it('agrees with the prefill text', () => {
    for (const n of [12.345, 1.005, 0.125, 1.234, 7.5])
      expect(parseAmountInput(formatAmountInput(n, 'en'))).toBe(roundAmount(n))
  })
})
