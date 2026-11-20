import { describe, expect, it } from 'vitest'
import { resolveOps, type ResolveMaps } from '@/lib/domain/import/finmap/resolve'
import type { FinmapExisting, PlannedOp } from '@/lib/domain/import/finmap/types'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'

// Synthetic names only.
const existing: FinmapExisting = {
  companyCurrency: 'PLN',
  accounts: [{ id: 'acc-old', name: 'Konto Alfa', currency: 'PLN' }],
  categories: [
    { id: 'cat-food', name: 'Jedzenie', type: 'expense' },
    { id: 'sub-groc', name: 'Spożywcze', type: 'expense', parentId: 'cat-food' },
    { id: 'cat-pay', name: 'Wypłata', type: 'income' },
  ],
  counterparties: [{ id: 'cp-old', name: 'Sklep Beta' }],
  tags: [{ id: 'tag-old', name: 'Wakacje' }],
}

const maps: ResolveMaps = {
  accounts: { 'konto gamma': 'acc-new' },
  categories: [
    { ref: { type: 'income', parent: 'Praca', child: null }, id: 'cat-work' },
    { ref: { type: 'income', parent: 'Praca', child: 'Premia' }, id: 'sub-bonus' },
    { ref: { type: 'expense', parent: 'Jedzenie', child: 'Kawiarnie' }, id: 'sub-cafe' },
  ],
  counterparties: { 'firma delta': 'cp-new' },
  tags: { nowy: 'tag-new', 'drugi tag': 'tag-second' },
}

function op(over: Partial<PlannedOp> = {}): PlannedOp {
  return {
    kind: 'expense',
    status: 'actual',
    day: '2026-11-03',
    amountMinor: 1250,
    account: 'Konto Alfa',
    toAccount: null,
    toAmountMinor: null,
    category: null,
    counterparty: null,
    tags: [],
    description: null,
    accrual: null,
    identity: ['11:00', '1250', 'expense'],
    ordinal: 0,
    lines: [2],
    ...over,
  }
}

describe('resolveOps', () => {
  it('maps names to ids by normKey, existing and newly created alike, one output per input', () => {
    const ops = [
      op({ counterparty: 'SKLEP  beta', tags: ['wakacje', 'Nowy'] }),
      op({ account: 'KONTO gamma', category: { type: 'income', parent: 'praca', child: null }, kind: 'income', identity: ['x'] }),
    ]
    const r = resolveOps(ops, maps, existing)
    expect(r.ops).toHaveLength(2)
    expect(r.ops[0]).toMatchObject({ accountId: 'acc-old', counterpartyId: 'cp-old', categoryId: null, tagIds: ['tag-old', 'tag-new'], toAccountId: null })
    expect(r.ops[1]).toMatchObject({ accountId: 'acc-new', categoryId: 'cat-work', kind: 'income' })
    expect(r.tagsDropped).toBe(0)
  })

  it('resolves a child category under an existing parent (existing child) and under a new parent (set-up child)', () => {
    const r = resolveOps(
      [
        op({ category: { type: 'expense', parent: 'Jedzenie', child: 'Spożywcze' } }),
        op({ kind: 'income', category: { type: 'income', parent: 'Praca', child: 'Premia' }, identity: ['y'] }),
        op({ category: { type: 'expense', parent: 'Jedzenie', child: 'Kawiarnie' }, identity: ['z'] }),
      ],
      maps,
      existing,
    )
    expect(r.ops.map((o) => o.categoryId)).toEqual(['sub-groc', 'sub-bonus', 'sub-cafe'])
  })

  it('maps a transfer by its two accounts and passes its amounts through, with no category or counterparty', () => {
    const r = resolveOps(
      [op({ kind: 'transfer', account: 'Konto Alfa', toAccount: 'Konto Gamma', toAmountMinor: 9900, identity: ['t'] })],
      maps,
      existing,
    )
    expect(r.ops[0]).toMatchObject({ kind: 'transfer', accountId: 'acc-old', toAccountId: 'acc-new', toAmountMinor: 9900, categoryId: null, counterpartyId: null })
  })

  it('passes description, accrual, identity, ordinal, status, day and amount through unchanged', () => {
    const accrual = { from: '2026-10-01', to: '2026-12-31' }
    const [out] = resolveOps([op({ status: 'planned', day: '2026-12-01', description: 'Opis', accrual, identity: ['a', 'b'], ordinal: 3 })], maps, existing).ops
    expect(out).toMatchObject({ status: 'planned', day: '2026-12-01', amountMinor: 1250, description: 'Opis', accrual, identity: ['a', 'b'], ordinal: 3 })
  })

  it('keeps the first MAX_TX_TAGS tags in order and counts the dropped ones', () => {
    const names = Array.from({ length: MAX_TX_TAGS + 3 }, (_, i) => `Tag ${i}`)
    const tagMaps: ResolveMaps = { ...maps, tags: Object.fromEntries(names.map((n, i) => [n.toLowerCase(), `t${i}`])) }
    const r = resolveOps([op({ tags: names })], tagMaps, existing)
    expect(r.ops[0].tagIds).toEqual(names.slice(0, MAX_TX_TAGS).map((_, i) => `t${i}`))
    expect(r.tagsDropped).toBe(3)
  })

  it('throws for a missing account, category, counterparty or tag, naming the line and not the name', () => {
    expect(() => resolveOps([op({ account: 'Nieznane Konto', lines: [7] })], maps, existing)).toThrow(/account.*line 7/)
    expect(() => resolveOps([op({ toAccount: 'Nieznane', kind: 'transfer', lines: [8] })], maps, existing)).toThrow(/account.*line 8/)
    expect(() => resolveOps([op({ category: { type: 'expense', parent: 'Brak', child: null }, lines: [9] })], maps, existing)).toThrow(/category.*line 9/)
    expect(() => resolveOps([op({ category: { type: 'expense', parent: 'Jedzenie', child: 'Brak' }, lines: [10] })], maps, existing)).toThrow(/category.*line 10/)
    expect(() => resolveOps([op({ counterparty: 'Nikt', lines: [11] })], maps, existing)).toThrow(/counterparty.*line 11/)
    expect(() => resolveOps([op({ tags: ['Brak'], lines: [12] })], maps, existing)).toThrow(/tag.*line 12/)
    // The set-up maps are plain records: an inherited property name is not an id.
    expect(() => resolveOps([op({ counterparty: 'constructor', lines: [13] })], maps, existing)).toThrow(/counterparty.*line 13/)
    expect(() => resolveOps([op({ account: 'toString', lines: [14] })], maps, existing)).toThrow(/account.*line 14/)
  })

  it('returns no operations for no input', () => {
    expect(resolveOps([], maps, existing)).toEqual({ ops: [], tagsDropped: 0 })
  })

  it('gives each tag once: two names that are one tag by normKey do not repeat its id', () => {
    const r = resolveOps([op({ tags: ['Wakacje', 'wakacje ', 'Nowy', 'NOWY'] })], maps, existing)
    expect(r.ops[0].tagIds).toEqual(['tag-old', 'tag-new'])
    expect(r.tagsDropped).toBe(0)
  })

  it('counts the distinct tags beyond the limit as dropped, not the repeated names', () => {
    const names = Array.from({ length: MAX_TX_TAGS }, (_, i) => `Tag ${i}`)
    const tagMaps: ResolveMaps = { ...maps, tags: { ...maps.tags, ...Object.fromEntries(names.map((n, i) => [n.toLowerCase(), `t${i}`])) } }
    const r = resolveOps([op({ tags: [...names, ...names.map((n) => n.toUpperCase()), 'Nowy'] })], tagMaps, existing)
    expect(r.ops[0].tagIds).toHaveLength(MAX_TX_TAGS)
    expect(r.tagsDropped).toBe(names.length + 1 - MAX_TX_TAGS)
  })
})
