import { describe, expect, it } from 'vitest'
import { formatDayText, maskDayText, parseDayText } from '@/lib/utils/date-text'

describe('formatDayText', () => {
  it('shows a day key as DD.MM.YYYY', () => {
    expect(formatDayText('2026-10-28')).toBe('28.10.2026')
  })
  it('gives an empty string for anything else', () => {
    expect(formatDayText('')).toBe('')
    expect(formatDayText('28.10.2026')).toBe('')
  })
})

describe('parseDayText', () => {
  it('parses DD.MM.YYYY and the other separators', () => {
    expect(parseDayText('28.10.2026')).toBe('2026-10-28')
    expect(parseDayText('28/10/2026')).toBe('2026-10-28')
    expect(parseDayText('28-10-2026')).toBe('2026-10-28')
  })
  it('pads a one-digit day or month', () => {
    expect(parseDayText('1.2.2026')).toBe('2026-02-01')
  })
  it('accepts a pasted day key', () => {
    expect(parseDayText('2026-10-28')).toBe('2026-10-28')
  })
  it('rejects dates that do not exist', () => {
    expect(parseDayText('31.02.2026')).toBeNull()
    expect(parseDayText('00.10.2026')).toBeNull()
    expect(parseDayText('28.13.2026')).toBeNull()
  })
  it('accepts a leap day only in a leap year', () => {
    expect(parseDayText('29.02.2028')).toBe('2028-02-29')
    expect(parseDayText('29.02.2027')).toBeNull()
  })
  it('rejects incomplete or malformed text', () => {
    expect(parseDayText('')).toBeNull()
    expect(parseDayText('28.10')).toBeNull()
    expect(parseDayText('28.10.26')).toBeNull()
    expect(parseDayText('abc')).toBeNull()
  })
})

describe('maskDayText', () => {
  it('adds the dots while digits are typed', () => {
    expect(maskDayText('2')).toBe('2')
    expect(maskDayText('28')).toBe('28')
    expect(maskDayText('281')).toBe('28.1')
    expect(maskDayText('2810')).toBe('28.10')
    expect(maskDayText('28102')).toBe('28.10.2')
    expect(maskDayText('28102026')).toBe('28.10.2026')
  })
  it('does not re-add a dot that Backspace just removed', () => {
    expect(maskDayText('28.')).toBe('28')
    expect(maskDayText('28.10.')).toBe('28.10')
  })
  it('drops non-digits and extra digits', () => {
    expect(maskDayText('28a10')).toBe('28.10')
    expect(maskDayText('281020261')).toBe('28.10.2026')
  })
  it('converts a pasted day key', () => {
    expect(maskDayText('2026-10-28')).toBe('28.10.2026')
  })
  it('normalises a pasted date with one-digit parts', () => {
    expect(maskDayText('1.2.2026')).toBe('01.02.2026')
  })
  it('keeps typed dots in place', () => {
    expect(maskDayText('28.10.2026')).toBe('28.10.2026')
  })
})
