import { describe, expect, it } from 'vitest'
import { accountMovementMinor, rollBackBalances } from '@/lib/domain/forecast/balances'

describe('rollBackBalances', () => {
  it('keeps the anchor balance on every day when nothing moved', () => {
    expect(rollBackBalances('2026-10-03', 100_000, new Map(), '2026-10-01')).toEqual(
      new Map([
        ['2026-10-03', 100_000],
        ['2026-10-02', 100_000],
        ['2026-10-01', 100_000],
      ]),
    )
  })

  it('takes the movement of each day off the balance of that day to get the close of the day before', () => {
    // Close of 3rd is 1000; the 3rd moved +20, so the 2nd closed at 980; the 2nd moved -50, so the 1st closed at 1030.
    const movement = new Map([
      ['2026-10-01', 100],
      ['2026-10-02', -50],
      ['2026-10-03', 20],
    ])
    expect(rollBackBalances('2026-10-03', 1_000, movement, '2026-10-01')).toEqual(
      new Map([
        ['2026-10-03', 1_000],
        ['2026-10-02', 980],
        ['2026-10-01', 1_030],
      ]),
    )
  })

  it('does not change the anchor balance by the movement of the anchor day itself', () => {
    // The anchor is the close of its own day, which already contains that day's movement; only the day before changes.
    const movement = new Map([['2026-10-03', 500]])
    const balances = rollBackBalances('2026-10-03', 1_000, movement, '2026-10-02')
    expect(balances.get('2026-10-03')).toBe(1_000)
    expect(balances.get('2026-10-02')).toBe(500)
  })

  it('returns the anchor alone for a single past day, whatever it moved', () => {
    const movement = new Map([['2026-10-01', 7_000]])
    expect(rollBackBalances('2026-10-01', 42_000, movement, '2026-10-01')).toEqual(new Map([['2026-10-01', 42_000]]))
  })

  it('returns nothing when the anchor lies before the first day', () => {
    expect(rollBackBalances('2026-09-30', 1_000, new Map(), '2026-10-01').size).toBe(0)
  })
})

describe('accountMovementMinor', () => {
  it('nets the money in and out of a day, transfers included', () => {
    expect(accountMovementMinor([{ inMinor: 50_000, outMinor: 20_000, transferInMinor: 7_000, transferOutMinor: 3_000 }])).toBe(34_000)
  })

  it('adds the excluded twin of the day to the analytics one', () => {
    // An excluded expense of 4000 leaves the account as well: the balance must count it.
    expect(accountMovementMinor([{ inMinor: 50_000 }, { outMinor: 4_000 }])).toBe(46_000)
  })

  it('is 0 for a day without rollup documents, or with fields the movement does not use', () => {
    expect(accountMovementMinor([undefined, undefined])).toBe(0)
    expect(accountMovementMinor([{ inBase: 9_000, outBase: 9_000 }])).toBe(0)
  })
})
