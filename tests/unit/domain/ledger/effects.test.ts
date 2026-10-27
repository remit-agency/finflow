import { describe, expect, it } from 'vitest'
import { balanceEffects, mergeEffects, negateEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'income', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})

describe('balanceEffects', () => {
  it('income adds, expense subtracts', () => {
    expect(balanceEffects(tx({ type: 'income' }))).toEqual({ a: 1000 })
    expect(balanceEffects(tx({ type: 'expense' }))).toEqual({ a: -1000 })
  })
  it('a transfer moves the amounts between two accounts', () => {
    expect(balanceEffects(tx({ type: 'transfer', toAccountId: 'b', toAmountMinor: 230, toCurrency: 'EUR' }))).toEqual({ a: -1000, b: 230 })
  })
  it('a planned operation has no effect', () => {
    expect(balanceEffects(tx({ status: 'planned' }))).toEqual({})
  })
})

describe('mergeEffects / negateEffects', () => {
  it('sums per account and drops zeros', () => {
    expect(mergeEffects({ a: 5, b: 1 }, { a: -5, c: 2 })).toEqual({ b: 1, c: 2 })
  })
  it('sums account ids that are members of Object.prototype like any other id', () => {
    expect(mergeEffects({ constructor: 5, toString: 1 }, { constructor: 2 })).toEqual({ constructor: 7, toString: 1 })
  })
  it('negates', () => {
    expect(negateEffects({ a: 5, b: -2 })).toEqual({ a: -5, b: 2 })
  })
})
