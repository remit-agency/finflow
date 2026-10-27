import { describe, expect, it } from 'vitest'
import { changeSet } from '@/lib/domain/ledger/change'
import { addInto, cashCatDocId, cashDocId, contributions, diffRollups, flatten, nest, plDocId, type RollupDocs } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'expense', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, categoryId: 'cat', isRecurring: false, tags: [], fileUrls: [], ...over,
})

const plain = (docs: RollupDocs) => Object.fromEntries(docs)

describe('contributions', () => {
  it('an expense in the company currency touches cash, cashcat and pl', () => {
    expect(plain(contributions(tx({}), 'PLN'))).toEqual({
      [cashDocId('a', '2026-10-20')]: { outMinor: 1000, outBase: 1000 },
      [cashCatDocId('2026-10')]: { 'categories.cat.expenseBase': 1000 },
      [plDocId('2026-10')]: { 'categories.cat.expenseBase': 1000 },
    })
  })

  it('income without a category goes to _none; sign -1 negates', () => {
    const t = tx({ type: 'income', categoryId: undefined })
    expect(plain(contributions(t, 'PLN', -1))[plDocId('2026-10')]).toEqual({ 'categories._none.incomeBase': -1000 })
  })

  it('uses base amounts for another currency and the accrual date for pl', () => {
    const t = tx({
      currency: 'EUR',
      accrual: { mode: 'date', date: '2026-09-15' },
      base: { payment: 4400, accrual: 4300 },
    })
    const docs = plain(contributions(t, 'PLN'))
    expect(docs[cashDocId('a', '2026-10-20')]).toEqual({ outMinor: 1000, outBase: 4400 })
    expect(docs[cashCatDocId('2026-10')]).toEqual({ 'categories.cat.expenseBase': 4400 })
    expect(docs[plDocId('2026-09')]).toEqual({ 'categories.cat.expenseBase': 4300 })
    expect(docs[plDocId('2026-10')]).toBeUndefined()
  })

  it('spreads a period over the months of pl', () => {
    const t = tx({ amountMinor: 1000, accrual: { mode: 'period', from: '2026-01-15', to: '2026-03-02' } })
    const docs = plain(contributions(t, 'PLN'))
    expect(docs[plDocId('2026-01')]).toEqual({ 'categories.cat.expenseBase': 361 })
    expect(docs[plDocId('2026-02')]).toEqual({ 'categories.cat.expenseBase': 595 })
    expect(docs[plDocId('2026-03')]).toEqual({ 'categories.cat.expenseBase': 44 })
  })

  it('a transfer is only cash movement on the two accounts', () => {
    const t = tx({ type: 'transfer', categoryId: undefined, toAccountId: 'b', toAmountMinor: 230, toCurrency: 'EUR' })
    expect(plain(contributions(t, 'PLN'))).toEqual({
      [cashDocId('a', '2026-10-20')]: { transferOutMinor: 1000 },
      [cashDocId('b', '2026-10-20')]: { transferInMinor: 230 },
    })
  })

  it('a planned operation contributes nothing', () => {
    expect(contributions(tx({ status: 'planned' }), 'PLN').size).toBe(0)
  })

  it('throws for an operation in another currency without base amounts', () => {
    expect(() => contributions(tx({ currency: 'EUR' }), 'PLN')).toThrow()
  })
})

describe('addInto', () => {
  it('sums, and removes entries that reach zero', () => {
    const target: RollupDocs = new Map()
    addInto(target, contributions(tx({}), 'PLN'))
    addInto(target, contributions(tx({}), 'PLN', -1))
    expect(target.size).toBe(0)
  })
})

describe('nest / flatten', () => {
  it('round-trips dotted fields', () => {
    const flat = { inMinor: 5, 'categories.c1.incomeBase': 7, 'categories.c2.expenseBase': -3 }
    const nested = nest(flat)
    expect(nested).toEqual({ inMinor: 5, categories: { c1: { incomeBase: 7 }, c2: { expenseBase: -3 } } })
    expect(flatten(nested)).toEqual(flat)
  })
  it('maps leaves', () => {
    expect(nest({ a: 2 }, (n) => ({ inc: n }))).toEqual({ a: { inc: 2 } })
  })
})

describe('diffRollups', () => {
  it('treats a missing document and zero fields as equal and reports real differences', () => {
    const a: RollupDocs = new Map([['x', { f: 1, z: 0 }]])
    const b: RollupDocs = new Map([['x', { f: 1 }]])
    expect(diffRollups(a, b)).toEqual([])
    const c: RollupDocs = new Map([['y', { f: 2 }]])
    expect(diffRollups(a, c)).toEqual([
      { docId: 'x', field: 'f', stored: 1, expected: 0 },
      { docId: 'y', field: 'f', stored: 0, expected: 2 },
    ])
  })
})

describe('changeSet', () => {
  it('create is +new, delete is -old, update is both', () => {
    const t = tx({})
    const create = changeSet(null, t, 'PLN')
    expect(create.balanceDeltas).toEqual({ a: -1000 })
    const del = changeSet(t, null, 'PLN')
    expect(del.balanceDeltas).toEqual({ a: 1000 })
    const edited = tx({ amountMinor: 1100 })
    const update = changeSet(t, edited, 'PLN')
    expect(update.balanceDeltas).toEqual({ a: -100 })
    expect(plain(update.rollupDeltas)[cashDocId('a', '2026-10-20')]).toEqual({ outMinor: 100, outBase: 100 })
  })
  it('moving an operation to another account and date rebalances both', () => {
    const t = tx({})
    const moved = tx({ accountId: 'b', paymentDate: '2026-10-21', accrual: { mode: 'date', date: '2026-10-21' } })
    expect(changeSet(t, moved, 'PLN').balanceDeltas).toEqual({ a: 1000, b: -1000 })
  })
})
