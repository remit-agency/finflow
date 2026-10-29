import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx: LedgerTransaction = {
  id: 't1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 5000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
  categoryId: 'k-fuel', autoRules: [{ id: 'r1', name: 'Paliwo' }],
}

describe('autoRules in the operation document', () => {
  it('round-trips the rules that filled the operation', () => {
    const doc = transactionToDoc(tx)
    expect(doc.autoRules).toEqual([{ id: 'r1', name: 'Paliwo' }])
    expect(parseTransaction('t1', doc)).toEqual(tx)
  })

  it('stores nothing for an operation no rule touched, or for an empty list', () => {
    const manual: LedgerTransaction = { ...tx }
    delete manual.autoRules
    expect('autoRules' in transactionToDoc(manual)).toBe(false)
    expect('autoRules' in transactionToDoc({ ...tx, autoRules: [] })).toBe(false)
    expect(parseTransaction('t1', transactionToDoc(manual))?.autoRules).toBeUndefined()
  })

  it('reads a malformed trace as none instead of hiding the operation', () => {
    const parsed = parseTransaction('t1', { ...transactionToDoc(tx), autoRules: [{ id: 5 }, 'x'] })
    expect(parsed).not.toBeNull()
    expect(parsed?.autoRules).toBeUndefined()
    expect(parseTransaction('t1', { ...transactionToDoc(tx), autoRules: 'r1' })?.autoRules).toBeUndefined()
  })

  it('keeps the well-formed entries of a partly malformed list', () => {
    const doc = { ...transactionToDoc(tx), autoRules: [{ id: 'r1', name: 'Paliwo' }, { id: 'r2' }] }
    expect(parseTransaction('t1', doc)?.autoRules).toEqual([{ id: 'r1', name: 'Paliwo' }])
  })
})
