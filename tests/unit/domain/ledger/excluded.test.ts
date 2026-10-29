import { describe, expect, it } from 'vitest'
import { changeSet } from '@/lib/domain/ledger/change'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { cashCatDocId, cashDocId, contributions, EXCLUDED_PREFIX, excludedDocId, plDocId, type RollupDocs } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { withExcluded } from '@/lib/domain/tags/exclude'

const tx = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 't', type: 'expense', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, categoryId: 'cat', isRecurring: false, tags: ['vat'], fileUrls: [], ...over,
})

const plain = (docs: RollupDocs) => Object.fromEntries(docs)

describe('an operation excluded from analytics', () => {
  it('adds the same fields, but to the x_ twins of cash, cashcat and pl', () => {
    expect(EXCLUDED_PREFIX).toBe('x_')
    expect(excludedDocId(cashDocId('a', '2026-10-20'))).toBe('x_cash_a_2026-10-20')
    expect(plain(contributions(tx({ excluded: true }), 'PLN'))).toEqual({
      'x_cash_a_2026-10-20': { outMinor: 1000, outBase: 1000 },
      'x_cashcat_2026-10': { 'categories.cat.expenseBase': 1000 },
      'x_pl_2026-10': { 'categories.cat.expenseBase': 1000 },
    })
  })

  it('a transfer goes to the x_ day documents of both accounts', () => {
    const t = tx({ type: 'transfer', categoryId: undefined, toAccountId: 'b', toAmountMinor: 1000, toCurrency: 'PLN', excluded: true })
    expect(plain(contributions(t, 'PLN'))).toEqual({
      'x_cash_a_2026-10-20': { transferOutMinor: 1000 },
      'x_cash_b_2026-10-20': { transferInMinor: 1000 },
    })
  })

  it('a planned one still contributes nothing', () => {
    expect(contributions(tx({ excluded: true, status: 'planned' }), 'PLN').size).toBe(0)
  })

  it('moves the balances exactly as without the flag', () => {
    expect(balanceEffects(tx({ excluded: true }))).toEqual(balanceEffects(tx()))
  })

  it('switching the flag moves the rollups between the twins and leaves the balances alone', () => {
    const change = changeSet(tx(), tx({ excluded: true }), 'PLN')
    expect(change.balanceDeltas).toEqual({})
    expect(plain(change.rollupDeltas)).toEqual({
      [cashDocId('a', '2026-10-20')]: { outMinor: -1000, outBase: -1000 },
      [cashCatDocId('2026-10')]: { 'categories.cat.expenseBase': -1000 },
      [plDocId('2026-10')]: { 'categories.cat.expenseBase': -1000 },
      'x_cash_a_2026-10-20': { outMinor: 1000, outBase: 1000 },
      'x_cashcat_2026-10': { 'categories.cat.expenseBase': 1000 },
      'x_pl_2026-10': { 'categories.cat.expenseBase': 1000 },
    })
  })
})

describe('the excluded field of a document', () => {
  it('is stored only when true and read back', () => {
    expect(transactionToDoc(tx()).excluded).toBeUndefined()
    expect(transactionToDoc(tx({ excluded: true })).excluded).toBe(true)
    expect(parseTransaction('t', transactionToDoc(tx({ excluded: true })))).toEqual(tx({ excluded: true }))
  })

  it('false or absent reads as not excluded (operations written before S10t)', () => {
    expect(parseTransaction('t', { ...transactionToDoc(tx()), excluded: false })).toEqual(tx())
    expect(parseTransaction('t', transactionToDoc(tx()))?.excluded).toBeUndefined()
  })

  it('a value that is not a boolean makes the document unreadable', () => {
    expect(parseTransaction('t', { ...transactionToDoc(tx()), excluded: 'yes' })).toBeNull()
  })
})

describe('withExcluded', () => {
  it('sets the flag, or removes the key', () => {
    expect(withExcluded(tx(), true)).toEqual(tx({ excluded: true }))
    expect(withExcluded(tx({ excluded: true }), false)).toEqual(tx())
    expect('excluded' in withExcluded(tx({ excluded: true }), false)).toBe(false)
  })
})
