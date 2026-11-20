import { describe, expect, it } from 'vitest'
import { splitByWriteBudget, writesOf, type OpFootprint } from '@/lib/domain/import/finmap/budget'
import { WRITE_BUDGET } from '@/lib/domain/import/finmap/types'

/** An operation footprint of `n` documents named by `prefix`, none shared with another operation. */
const own = (prefix: string, n: number): OpFootprint => ({ docs: Array.from({ length: n }, (_, j) => `${prefix}-${j}`) })

/** The writes a group of footprints costs: 2 per operation, their distinct documents, 1 audit entry. */
function costOf(group: number[], footprints: readonly OpFootprint[]): number {
  const docs = new Set(group.flatMap((i) => footprints[i].docs))
  return writesOf(group.length, docs.size)
}

describe('splitByWriteBudget', () => {
  it('keeps 60 operations that share three documents in one group', () => {
    const shared = ['accounts/a', 'rollups/cash_a_d', 'rollups/cashcat_m']
    const footprints = Array.from({ length: 60 }, () => ({ docs: shared }))
    expect(splitByWriteBudget(footprints)).toEqual([Array.from({ length: 60 }, (_, i) => i)])
  })

  it('splits operations that each touch 10 distinct documents at the exact budget', () => {
    // 2n + 10n + 1 <= 450 holds for n = 37 (445) and fails for n = 38 (457).
    const footprints = Array.from({ length: 100 }, (_, i) => own(`op${i}`, 10))
    const groups = splitByWriteBudget(footprints)
    expect(groups.map((g) => g.length)).toEqual([37, 37, 26])
    expect(groups[0]).toEqual(Array.from({ length: 37 }, (_, i) => i))
    expect(groups[1][0]).toBe(37)
    expect(groups[2][25]).toBe(99)
    for (const g of groups) expect(costOf(g, footprints)).toBeLessThanOrEqual(WRITE_BUDGET)
  })

  it('covers every index once, in order, and keeps every group within the budget', () => {
    const footprints = Array.from({ length: 300 }, (_, i) => own(`op${i}`, i % 7))
    const groups = splitByWriteBudget(footprints)
    expect(groups.flat()).toEqual(Array.from({ length: 300 }, (_, i) => i))
    for (const g of groups) expect(costOf(g, footprints)).toBeLessThanOrEqual(WRITE_BUDGET)
  })

  it('gives an operation that alone exceeds the budget a group of its own, never an empty one', () => {
    const footprints = [own('small', 1), own('huge', 500), own('small2', 1)]
    expect(splitByWriteBudget(footprints)).toEqual([[0], [1], [2]])
  })

  it('returns no groups for no operations', () => {
    expect(splitByWriteBudget([])).toEqual([])
  })

  it('honours a smaller budget passed explicitly', () => {
    const footprints = Array.from({ length: 4 }, (_, i) => own(`op${i}`, 1))
    // 2n + n + 1 = 3n + 1: n = 3 costs 10, n = 4 costs 13.
    expect(splitByWriteBudget(footprints, 12)).toEqual([[0, 1, 2], [3]])
  })
})
