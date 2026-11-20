import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const base: LedgerTransaction = {
  id: 'fm_1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 500, currency: 'PLN', paymentDate: '2026-10-02',
  accrual: { mode: 'date', date: '2026-10-02' }, isRecurring: false, tags: [], fileUrls: [],
}

describe('importId', () => {
  it('is stored and read back', () => {
    const doc = transactionToDoc({ ...base, importId: 'imp1' })
    expect(doc.importId).toBe('imp1')
    expect(parseTransaction('fm_1', doc)?.importId).toBe('imp1')
  })
  it('is absent when the operation has none', () => {
    expect('importId' in transactionToDoc(base)).toBe(false)
    expect(parseTransaction('x', transactionToDoc(base))?.importId).toBeUndefined()
  })
  it('a malformed importId makes the document unreadable', () => {
    expect(parseTransaction('x', { ...transactionToDoc(base), importId: 5 })).toBeNull()
  })
})
