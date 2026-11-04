import { describe, expect, it } from 'vitest'
import { arrowExpandTarget, listWindow, MAX_LIST_ROWS } from '@/lib/ui/filter-list'

describe('listWindow: how many rows an open list shows', () => {
  const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

  it('a flat list shows at most MAX_LIST_ROWS and counts the rest', () => {
    const out = listWindow(rows(MAX_LIST_ROWS + 50), false)
    expect(out.shown).toHaveLength(MAX_LIST_ROWS)
    expect(out.hidden).toBe(50)
  })

  it('a tree is never cut: its last rows (the uncategorised rows, the transfers) stay in view, however many categories there are', () => {
    const out = listWindow(rows(MAX_LIST_ROWS * 3), true)
    expect(out.shown).toHaveLength(MAX_LIST_ROWS * 3)
    expect(out.shown.at(-1)).toBe(MAX_LIST_ROWS * 3 - 1)
    expect(out.hidden).toBe(0)
  })

  it('a short list is shown whole in both kinds', () => {
    expect(listWindow(rows(3), false)).toEqual({ shown: [0, 1, 2], hidden: 0 })
    expect(listWindow(rows(3), true)).toEqual({ shown: [0, 1, 2], hidden: 0 })
  })
})

describe('arrowExpandTarget: the arrows open and close a tree row, unless they edit the search', () => {
  it('ArrowRight opens a closed row and ArrowLeft closes an open one, with nothing typed', () => {
    expect(arrowExpandTarget('ArrowRight', '', false)).toBe(true)
    expect(arrowExpandTarget('ArrowLeft', '', true)).toBe(false)
  })

  it('a row already in the state the arrow asks for is left alone', () => {
    expect(arrowExpandTarget('ArrowRight', '', true)).toBeUndefined()
    expect(arrowExpandTarget('ArrowLeft', '', false)).toBeUndefined()
  })

  it('a row without children does nothing', () => {
    expect(arrowExpandTarget('ArrowRight', '', undefined)).toBeUndefined()
  })

  it('while something is typed the arrows move the caret and never open or close the row', () => {
    expect(arrowExpandTarget('ArrowRight', 'kon', false)).toBeUndefined()
    expect(arrowExpandTarget('ArrowLeft', 'kon', true)).toBeUndefined()
  })

  it('other keys do nothing', () => {
    expect(arrowExpandTarget('ArrowDown', '', false)).toBeUndefined()
    expect(arrowExpandTarget('Enter', '', false)).toBeUndefined()
  })
})
