import { describe, expect, it } from 'vitest'
import {
  buildKindTree,
  kindState,
  matchesAnalyticsKinds,
  noCategoryId,
  normaliseKinds,
  parseNoCategoryId,
  rootState,
  toggleKind,
  type KindCategory,
  type KindSelection,
} from '@/lib/domain/analytics-filter/kinds'
import type { TxType } from '@/lib/domain/ledger/types'

const cat = (id: string, type: 'income' | 'expense', parentId?: string): KindCategory & { name: string } => ({ id, type, parentId, name: id })

/** Income: sales; services > consulting > tax (three levels). Expense: rent; fuel > shell. */
const categories = [
  cat('inc-sales', 'income'),
  cat('inc-services', 'income'),
  cat('inc-consult', 'income', 'inc-services'),
  cat('inc-consult-tax', 'income', 'inc-consult'),
  cat('exp-rent', 'expense'),
  cat('exp-fuel', 'expense'),
  cat('exp-fuel-shell', 'expense', 'exp-fuel'),
]
const tree = buildKindTree(categories)
const sel = (types: TxType[] = [], categoryIds: string[] = []): KindSelection => ({ types, categoryIds })

interface Op {
  id: string
  type: TxType
  categoryId?: string
}
const ops: Op[] = [
  { id: 'sale', type: 'income', categoryId: 'inc-sales' },
  { id: 'tax', type: 'income', categoryId: 'inc-consult-tax' },
  { id: 'unc-in', type: 'income' },
  { id: 'rent', type: 'expense', categoryId: 'exp-rent' },
  { id: 'fuel-parent', type: 'expense', categoryId: 'exp-fuel' },
  { id: 'shell', type: 'expense', categoryId: 'exp-fuel-shell' },
  { id: 'unc-exp', type: 'expense' },
  { id: 'move', type: 'transfer' },
]
const matching = (s: KindSelection): string[] => ops.filter((op) => matchesAnalyticsKinds(op, s)).map((op) => op.id)

describe('the uncategorised sentinel in the address', () => {
  it('is one id per payment type with a colon, read back by exact match only', () => {
    expect(noCategoryId('income')).toBe('_none:income')
    expect(noCategoryId('expense')).toBe('_none:expense')
    expect(parseNoCategoryId('_none:income')).toBe('income')
    expect(parseNoCategoryId('_none:expense')).toBe('expense')
    for (const bad of ['_none', '_none:', '_none:transfer', '_none:income:x', 'income', 'x_none:income']) {
      expect(parseNoCategoryId(bad), bad).toBeUndefined()
    }
  })
})

describe('the tree of payment types and categories', () => {
  it('has one group per payment type with every category of the type, at any depth', () => {
    expect([...tree.income.members].sort()).toEqual(['inc-consult', 'inc-consult-tax', 'inc-sales', 'inc-services'])
    expect(tree.income.roots.map((n) => n.category.id)).toEqual(['inc-sales', 'inc-services'])
    const services = tree.nodes.get('inc-services')!
    expect(services.children.map((n) => n.category.id)).toEqual(['inc-consult'])
    expect(services.children[0].children.map((n) => n.category.id)).toEqual(['inc-consult-tax'])
  })

  it('a category whose parent is missing (deleted, or of another type) is a root of its group', () => {
    const t = buildKindTree([cat('a', 'income', 'gone'), cat('b', 'income', 'exp-x'), cat('x', 'expense')])
    expect(t.income.roots.map((n) => n.category.id)).toEqual(['a', 'b'])
  })

  it('a loop of parents hides none of its categories', () => {
    const t = buildKindTree([cat('a', 'income', 'b'), cat('b', 'income', 'a'), cat('c', 'income', 'a')])
    expect([...t.income.members].sort()).toEqual(['a', 'b', 'c'])
    expect(t.nodes.get('c')).toBeDefined()
    expect(t.income.roots.map((n) => n.category.id).sort()).toEqual(['a', 'b'])
  })

  it('keeps the order the caller gives among siblings', () => {
    const t = buildKindTree(categories, (x, y) => (x.id < y.id ? 1 : x.id > y.id ? -1 : 0))
    expect(t.income.roots.map((n) => n.category.id)).toEqual(['inc-services', 'inc-sales'])
  })
})

describe('the union rule of the reports (matchesAnalyticsKinds)', () => {
  it('without a choice everything matches, the uncategorised and transfers too', () => {
    expect(matching(sel())).toEqual(ops.map((op) => op.id))
  })

  it('a whole group: all its operations, its uncategorised ones and no operation of the other group (the owner example)', () => {
    expect(matching(sel(['income']))).toEqual(['sale', 'tax', 'unc-in'])
    expect(matching(sel(['expense']))).toEqual(['rent', 'fuel-parent', 'shell', 'unc-exp'])
  })

  it('one category matches only its operations', () => {
    expect(matching(sel([], ['exp-rent']))).toEqual(['rent'])
  })

  it('a single subcategory matches only itself, not its parent', () => {
    expect(matching(sel([], ['exp-fuel-shell']))).toEqual(['shell'])
    expect(matching(sel([], ['exp-fuel']))).toEqual(['fuel-parent'])
  })

  it('the uncategorised row of a type matches that type only', () => {
    expect(matching(sel([], ['_none:expense']))).toEqual(['unc-exp'])
    expect(matching(sel([], ['_none:income']))).toEqual(['unc-in'])
  })

  it('transfers: their own row, and the uncategorised rows never match them', () => {
    expect(matching(sel(['transfer']))).toEqual(['move'])
    expect(matching(sel([], ['_none:income', '_none:expense']))).toEqual(['unc-in', 'unc-exp'])
  })

  it('a group plus one category of the other type is the union (not an intersection)', () => {
    expect(matching(sel(['income'], ['exp-rent']))).toEqual(['sale', 'tax', 'unc-in', 'rent'])
  })
})

describe('the tri-state is derived from the stored choice and the tree', () => {
  it('nothing chosen: the root is checked (no restriction), every row unchecked', () => {
    expect(rootState(sel())).toBe('checked')
    expect(kindState(sel(), tree, { kind: 'group', type: 'income' })).toBe('unchecked')
    expect(kindState(sel(), tree, { kind: 'category', id: 'inc-sales' })).toBe('unchecked')
  })

  it('a whole group: the group, its categories and its uncategorised row are checked; the root and the other group follow', () => {
    const s = sel(['income'])
    expect(rootState(s)).toBe('mixed')
    expect(kindState(s, tree, { kind: 'group', type: 'income' })).toBe('checked')
    expect(kindState(s, tree, { kind: 'category', id: 'inc-services' })).toBe('checked')
    expect(kindState(s, tree, { kind: 'category', id: 'inc-consult-tax' })).toBe('checked')
    expect(kindState(s, tree, { kind: 'uncategorised', type: 'income' })).toBe('checked')
    expect(kindState(s, tree, { kind: 'group', type: 'expense' })).toBe('unchecked')
  })

  it('a child chosen alone makes its parents and its group mixed', () => {
    const s = sel([], ['inc-consult-tax'])
    expect(kindState(s, tree, { kind: 'category', id: 'inc-consult-tax' })).toBe('checked')
    expect(kindState(s, tree, { kind: 'category', id: 'inc-consult' })).toBe('mixed')
    expect(kindState(s, tree, { kind: 'category', id: 'inc-services' })).toBe('mixed')
    expect(kindState(s, tree, { kind: 'group', type: 'income' })).toBe('mixed')
    expect(kindState(s, tree, { kind: 'uncategorised', type: 'income' })).toBe('unchecked')
  })

  it('a parent stored alone (a hand-made link) is mixed while its children are not chosen', () => {
    expect(kindState(sel([], ['exp-fuel']), tree, { kind: 'category', id: 'exp-fuel' })).toBe('mixed')
  })

  it('transfers and the uncategorised rows have their own state', () => {
    expect(kindState(sel(['transfer']), tree, { kind: 'transfer' })).toBe('checked')
    expect(kindState(sel([], ['_none:expense']), tree, { kind: 'uncategorised', type: 'expense' })).toBe('checked')
  })
})

describe('toggling a row of the tree', () => {
  const ok = (r: ReturnType<typeof toggleKind>): KindSelection => {
    if (!r.ok) throw new Error(`limit`)
    return r.selection
  }

  it('the group ticked from nothing is stored as the group, not as its ids', () => {
    expect(ok(toggleKind(sel(), tree, { kind: 'group', type: 'income' }, true))).toEqual(sel(['income']))
  })

  it('every row of a group ticked one by one ends as the group', () => {
    let s = sel()
    for (const ref of [
      { kind: 'category', id: 'inc-sales' },
      { kind: 'category', id: 'inc-services' },
      { kind: 'uncategorised', type: 'income' },
    ] as const) s = ok(toggleKind(s, tree, ref, true))
    expect(s).toEqual(sel(['income']))
  })

  it('ticking everything (income, expense and transfers) is no restriction at all', () => {
    let s = sel()
    for (const ref of [{ kind: 'group', type: 'income' }, { kind: 'group', type: 'expense' }, { kind: 'transfer' }] as const) {
      s = ok(toggleKind(s, tree, ref, true))
    }
    expect(s).toEqual(sel())
  })

  it('a parent ticked ticks it and all its descendants', () => {
    expect(ok(toggleKind(sel(), tree, { kind: 'category', id: 'exp-fuel' }, true))).toEqual(sel([], ['exp-fuel', 'exp-fuel-shell']))
  })

  it('a single subcategory ticked alone is only that one', () => {
    expect(ok(toggleKind(sel(), tree, { kind: 'category', id: 'exp-fuel-shell' }, true))).toEqual(sel([], ['exp-fuel-shell']))
  })

  it('a mixed row ticked becomes fully ticked', () => {
    const s = sel([], ['inc-consult-tax'])
    expect(ok(toggleKind(s, tree, { kind: 'category', id: 'inc-services' }, true))).toEqual(
      sel([], ['inc-services', 'inc-consult', 'inc-consult-tax']),
    )
  })

  it('unticking one category of a ticked group keeps the rest of the group as ids (the group is no longer whole)', () => {
    expect(ok(toggleKind(sel(['income']), tree, { kind: 'category', id: 'inc-consult-tax' }, false))).toEqual(
      sel([], ['inc-sales', 'inc-services', 'inc-consult', '_none:income']),
    )
  })

  it('unticking a ticked group clears it', () => {
    expect(ok(toggleKind(sel(['income']), tree, { kind: 'group', type: 'income' }, false))).toEqual(sel())
  })

  it('unticking a parent clears its subtree and nothing else', () => {
    const s = sel([], ['exp-fuel', 'exp-fuel-shell', 'exp-rent'])
    expect(ok(toggleKind(s, tree, { kind: 'category', id: 'exp-fuel' }, false))).toEqual(sel([], ['exp-rent']))
  })

  it('a row beyond the 30 ids of the address is refused, not cut', () => {
    const big = buildKindTree([cat('p', 'expense'), ...Array.from({ length: 30 }, (_, i) => cat(`k${i}`, 'expense', 'p'))])
    expect(toggleKind(sel(), big, { kind: 'category', id: 'p' }, true)).toEqual({ ok: false, reason: 'limit' })
  })
})

describe('normalising the stored choice (once, on read and on write)', () => {
  it('a group whose every category and uncategorised row are stored becomes the group', () => {
    const stored = sel([], ['inc-sales', 'inc-services', 'inc-consult', 'inc-consult-tax', '_none:income'])
    expect(normaliseKinds(stored, tree)).toEqual(sel(['income']))
  })

  it('a stored group implies its ids: they are dropped, the other ids stay', () => {
    expect(normaliseKinds(sel(['income'], ['exp-rent', 'inc-sales']), tree)).toEqual(sel(['income'], ['exp-rent']))
  })

  it('every payment type and transfers chosen is no restriction', () => {
    expect(normaliseKinds(sel(['income', 'expense', 'transfer'], ['exp-rent']), tree)).toEqual(sel())
  })

  it('a choice already in normal form comes back unchanged', () => {
    expect(normaliseKinds(sel(['transfer'], ['exp-rent']), tree)).toEqual(sel(['transfer'], ['exp-rent']))
  })
})
