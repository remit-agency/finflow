// tests/unit/domain/journal/balance.test.ts
import { describe, expect, it } from 'vitest'
import { balancesAfter } from '@/lib/domain/journal/balance'

describe('balancesAfter', () => {
  it('the newest operation shows the balance now when nothing is newer', () => {
    const out = balancesAfter(1000, 0, [{ day: '2026-10-03', ops: [{ id: 'c', effect: 100 }, { id: 'b', effect: -50 }] }], [])
    expect(out.get('c')).toBe(1000)
    expect(out.get('b')).toBe(900)
  })
  it('subtracts what is newer than the page', () => {
    // 1000 now, 300 of net movement happened after the page's newest day
    const out = balancesAfter(1000, 300, [{ day: '2026-10-03', ops: [{ id: 'a', effect: 10 }] }], [])
    expect(out.get('a')).toBe(700)
  })
  it('walks across days and the gaps between them', () => {
    const out = balancesAfter(
      1000,
      0,
      [
        { day: '2026-10-05', ops: [{ id: 'x', effect: 200 }] },
        { day: '2026-10-01', ops: [{ id: 'y', effect: -30 }] },
      ],
      [40], // days strictly between 10-01 and 10-05 moved the account by +40
    )
    expect(out.get('x')).toBe(1000)
    expect(out.get('y')).toBe(1000 - 200 - 40)
  })
  it('handles an empty page', () => {
    expect(balancesAfter(5, 0, [], []).size).toBe(0)
  })
})
