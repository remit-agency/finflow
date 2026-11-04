import { describe, expect, it } from 'vitest'
import { highlightedRow } from '@/lib/ui/highlight'

describe('highlightedRow (S10t rule, shared with the report filters of S10f)', () => {
  it('nothing is highlighted before typing or moving', () => {
    expect(highlightedRow(3, '', null)).toBe(-1)
  })
  it('typing highlights the first row', () => {
    expect(highlightedRow(3, 'pd', null)).toBe(0)
  })
  it('a moved highlight wins and is clamped to a shorter list', () => {
    expect(highlightedRow(3, '', 1)).toBe(1)
    expect(highlightedRow(2, 'x', 5)).toBe(1)
  })
  it('an empty list has no highlight', () => {
    expect(highlightedRow(0, 'x', 2)).toBe(-1)
  })
})
