import { describe, expect, it } from 'vitest'
import { backgroundSlot } from '@/lib/domain/banking/slot'

describe('backgroundSlot (day and hour are Warsaw)', () => {
  it.each([
    ['2026-10-27', 8, '2026-10-27#08'],
    ['2026-10-27', 12, '2026-10-27#08'],
    ['2026-10-27', 13, '2026-10-27#13'],
    ['2026-10-27', 16, '2026-10-27#13'],
    ['2026-10-27', 17, '2026-10-27#17'],
    ['2026-10-27', 23, '2026-10-27#17'],
  ])('%s %s:00 -> %s', (day, hour, slot) => {
    expect(backgroundSlot(day, hour)).toBe(slot)
  })

  it('the small hours belong to the evening slot of the day before', () => {
    expect(backgroundSlot('2026-10-27', 0)).toBe('2026-10-26#17')
    expect(backgroundSlot('2026-10-27', 7)).toBe('2026-10-26#17')
    expect(backgroundSlot('2026-11-01', 3)).toBe('2026-10-31#17')
    expect(backgroundSlot('2027-01-01', 2)).toBe('2026-12-31#17')
  })
})
