import { describe, expect, it } from 'vitest'
import { todayDay, todayUtcDay, warsawHour } from '@/lib/utils/today'

const iso = (d: Date) => d.toISOString()

describe('todayUtcDay', () => {
  it('is the Warsaw calendar date at 00:00 UTC', () => {
    expect(iso(todayUtcDay(new Date('2026-01-15T10:00:00Z')))).toBe('2026-01-15T00:00:00.000Z')
  })

  it('winter: 23:30 UTC is already the next day in Warsaw (UTC+1)', () => {
    expect(iso(todayUtcDay(new Date('2026-01-15T23:30:00Z')))).toBe('2026-01-16T00:00:00.000Z')
    expect(iso(todayUtcDay(new Date('2026-01-15T22:59:00Z')))).toBe('2026-01-15T00:00:00.000Z')
  })

  it('summer: 22:30 UTC is already the next day in Warsaw (UTC+2)', () => {
    expect(iso(todayUtcDay(new Date('2026-07-15T22:30:00Z')))).toBe('2026-07-16T00:00:00.000Z')
    expect(iso(todayUtcDay(new Date('2026-07-15T21:59:00Z')))).toBe('2026-07-15T00:00:00.000Z')
  })

  it('handles the DST switch days', () => {
    expect(iso(todayUtcDay(new Date('2026-03-28T23:30:00Z')))).toBe('2026-03-29T00:00:00.000Z') // still +1 until 01:00 UTC on the 29th
    expect(iso(todayUtcDay(new Date('2026-10-24T22:30:00Z')))).toBe('2026-10-25T00:00:00.000Z') // +2 until 01:00 UTC on the 25th
    expect(iso(todayUtcDay(new Date('2026-10-25T22:30:00Z')))).toBe('2026-10-25T00:00:00.000Z') // +1 afterwards
  })

  it('defaults to the current time', () => {
    expect(todayUtcDay().getUTCHours()).toBe(0)
  })
})

describe('todayDay', () => {
  it('is the Warsaw calendar day as YYYY-MM-DD', () => {
    expect(todayDay(new Date('2026-10-28T12:00:00Z'))).toBe('2026-10-28')
  })

  it('moves to the next day once Warsaw is past midnight while UTC is not', () => {
    // 2026-10-28 23:30 UTC is 00:30 on the 29th in Warsaw (CET, UTC+1).
    expect(todayDay(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29')
  })
})

describe('warsawHour', () => {
  it('is the hour on a Warsaw clock, summer time (UTC+2)', () => {
    expect(warsawHour(new Date('2026-10-24T06:30:00Z'))).toBe(8)
    expect(warsawHour(new Date('2026-07-01T21:59:00Z'))).toBe(23)
    expect(warsawHour(new Date('2026-07-01T22:00:00Z'))).toBe(0)
  })

  it('is the hour on a Warsaw clock, winter time (UTC+1)', () => {
    expect(warsawHour(new Date('2026-10-27T10:00:00Z'))).toBe(11)
    expect(warsawHour(new Date('2026-12-01T23:30:00Z'))).toBe(0)
  })

  it('follows the clock change (2026-10-25 back to winter, 2026-03-29 forward to summer)', () => {
    expect(warsawHour(new Date('2026-10-25T06:30:00Z'))).toBe(7)
    expect(warsawHour(new Date('2026-03-29T05:30:00Z'))).toBe(7)
    expect(warsawHour(new Date('2026-03-29T06:30:00Z'))).toBe(8)
  })
})
