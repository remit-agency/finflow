import { describe, expect, it } from 'vitest'
import { allocatePeriod } from '@/lib/domain/ledger/period'

const sum = (parts: Array<[string, number]>) => parts.reduce((a, [, v]) => a + v, 0)

describe('allocatePeriod', () => {
  it('splits by days and puts the remainder in the last month', () => {
    const parts = allocatePeriod(1000, '2026-01-15', '2026-03-02')
    expect(parts).toEqual([
      ['2026-01', 361],
      ['2026-02', 595],
      ['2026-03', 44],
    ])
    expect(sum(parts)).toBe(1000)
  })

  it('keeps the sign for a negative total', () => {
    const parts = allocatePeriod(-1000, '2026-01-15', '2026-03-02')
    expect(parts).toEqual([
      ['2026-01', -361],
      ['2026-02', -595],
      ['2026-03', -44],
    ])
  })

  it('one month gets everything', () => {
    expect(allocatePeriod(777, '2026-05-01', '2026-05-31')).toEqual([['2026-05', 777]])
  })

  it('crosses a year end and a leap February', () => {
    const parts = allocatePeriod(10_000, '2027-12-20', '2028-03-10')
    expect(parts.map(([m]) => m)).toEqual(['2027-12', '2028-01', '2028-02', '2028-03'])
    expect(sum(parts)).toBe(10_000)
  })

  it('never produces -0', () => {
    for (const [, v] of allocatePeriod(-1, '2026-01-01', '2026-03-31')) {
      expect(Object.is(v, -0)).toBe(false)
    }
  })

  it('is exact for the largest amounts (no float overflow in the multiplication)', () => {
    const parts = allocatePeriod(50_000_000_000_000, '2026-01-01', '2028-12-31')
    expect(sum(parts)).toBe(50_000_000_000_000)
  })
})
