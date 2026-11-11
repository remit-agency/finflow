import { describe, expect, it } from 'vitest'
import { categoryTreeRows, parseReportCategory, rowRank } from '@/lib/domain/reports/categories'
import { CATEGORIES } from './fixtures'

describe('categoryTreeRows', () => {
  it('a parent carries its subtree, a child is one level deeper, empty rows are left out, the uncategorised row comes last', () => {
    const rows = categoryTreeRows(
      [
        { row: 'cat-cloud', type: 'expense', amountBase: 4_050 },
        { row: 'cat-it', type: 'expense', amountBase: 12_000 },
        { row: '_none:expense', type: 'expense', amountBase: 1_000 },
        { row: 'cat-in', type: 'income', amountBase: 50_000 },
      ],
      CATEGORIES,
    )
    expect(rows).toEqual([
      { row: 'cat-in', type: 'income', level: 0, amountBase: 50_000 },
      { row: 'cat-it', type: 'expense', level: 0, amountBase: 16_050 },
      { row: 'cat-cloud', type: 'expense', level: 1, amountBase: 4_050 },
      { row: '_none:expense', type: 'expense', level: 0, amountBase: 1_000 },
    ])
  })

  it('a row the tree does not know, or of the other type, counts as uncategorised', () => {
    expect(categoryTreeRows([{ row: 'cat-gone', type: 'expense', amountBase: 300 }, { row: 'cat-in', type: 'expense', amountBase: 200 }], CATEGORIES)).toEqual([
      { row: '_none:expense', type: 'expense', level: 0, amountBase: 500 },
    ])
  })

  it('a parent without amounts of its own shows the sum of its children', () => {
    expect(categoryTreeRows([{ row: 'cat-cloud', type: 'expense', amountBase: 4_050 }], CATEGORIES)).toEqual([
      { row: 'cat-it', type: 'expense', level: 0, amountBase: 4_050 },
      { row: 'cat-cloud', type: 'expense', level: 1, amountBase: 4_050 },
    ])
  })
})

describe('rowRank', () => {
  it('the caller order of the categories, the uncategorised row after them, unknown ids last', () => {
    const rank = rowRank(CATEGORIES)
    const rows = ['_none:expense', 'cat-gone', 'cat-cloud', 'cat-it']
    expect([...rows].sort((a, b) => rank('expense', a) - rank('expense', b))).toEqual(['cat-it', 'cat-cloud', '_none:expense', 'cat-gone'])
  })
})

describe('parseReportCategory', () => {
  it('reads the name, the type and the parent; anything else is null', () => {
    expect(parseReportCategory('c1', { name: 'IT', type: 'expense', parentId: 'p', color: '#000000', orgId: 'o' })).toEqual({ id: 'c1', name: 'IT', type: 'expense', parentId: 'p' })
    expect(parseReportCategory('c2', { name: 'Sprzedaż', type: 'income' })).toEqual({ id: 'c2', name: 'Sprzedaż', type: 'income' })
    expect(parseReportCategory('c3', { name: 'X', type: 'transfer' })).toBeNull()
    expect(parseReportCategory('c4', { type: 'income' })).toBeNull()
    expect(parseReportCategory('c5', null)).toBeNull()
  })
})
