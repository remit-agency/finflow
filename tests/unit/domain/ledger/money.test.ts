import { describe, expect, it } from 'vitest'
import { MAX_MINOR, fromMinor, isMinor, mulRate, parseMinorInput, toMinor } from '@/lib/domain/ledger/money'

describe('parseMinorInput', () => {
  it.each([
    ['3200', 320_000],
    ['3 200,50', 320_050],
    ['1,234.5', 123_450],
    ['0', 0],
    ['0,125', 13],
  ])('reads what a person types as minor units: %s', (text, minor) => {
    expect(parseMinorInput(text)).toBe(minor)
  })

  it.each(['', '-5', '−5', 'abc', '1,2,3,4', '1e3'])('gives null for what is not an amount: %j', (text) => {
    expect(parseMinorInput(text)).toBeNull()
  })

  it('accepts an amount exactly at the server limit (MAX_MINOR minor units)', () => {
    expect(parseMinorInput('100000000000')).toBe(MAX_MINOR)
    expect(parseMinorInput('99 999 999 999,99')).toBe(MAX_MINOR - 1)
  })

  it('gives null for an amount one minor unit above the server limit', () => {
    expect(parseMinorInput('100000000000,01')).toBeNull()
    expect(parseMinorInput('100000000001')).toBeNull()
  })
})

describe('toMinor / fromMinor', () => {
  it.each([
    [12.34, 1234],
    [1234.6, 123460],
    [0.1 + 0.2, 30],
    [0.29, 29],
    [10.5, 1050],
    [-0.1, -10],
    [0, 0],
  ])('toMinor(%s) = %s', (major, minor) => {
    expect(toMinor(major)).toBe(minor)
  })

  it('never returns -0', () => {
    expect(Object.is(toMinor(-0.001), 0)).toBe(true)
  })

  it('rejects a non-finite amount', () => {
    expect(() => toMinor(Number.NaN)).toThrow(RangeError)
    expect(() => toMinor(Infinity)).toThrow(RangeError)
  })

  it('fromMinor is the inverse for 2-decimal amounts', () => {
    expect(fromMinor(123460)).toBe(1234.6)
    expect(fromMinor(-10)).toBe(-0.1)
  })
})

describe('mulRate', () => {
  it('rounds half away from zero', () => {
    expect(mulRate(1000, 4.4026)).toBe(4403)
    expect(mulRate(-1000, 4.4026)).toBe(-4403)
    expect(mulRate(5, 0.5)).toBe(3)
    expect(mulRate(-5, 0.5)).toBe(-3)
    expect(mulRate(1, 0.0001)).toBe(0)
  })
})

describe('isMinor', () => {
  it('accepts safe integers only', () => {
    expect(isMinor(5)).toBe(true)
    expect(isMinor(-5)).toBe(true)
    expect(isMinor(0.5)).toBe(false)
    expect(isMinor('5')).toBe(false)
    expect(isMinor(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
  })
  it('MAX_MINOR is a safe integer', () => {
    expect(Number.isSafeInteger(MAX_MINOR)).toBe(true)
  })
})
