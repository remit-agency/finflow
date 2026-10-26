import { describe, expect, it } from 'vitest'
import { addDays, isDay, monthBounds, monthOf, prevMonth } from '@/lib/server/fx/days'

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
