import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx: LedgerTransaction = {
  id: 'bk_1', type: 'income', status: 'actual', accountId: 'a1', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
  bank: { accountRef: 'ba1', entryReference: 'ref-1', counterpartyName: 'ACME', remittance: 'Faktura 1' },
}

describe('bank block in the operation document', () => {
  it('round-trips source and bank', () => {
    const doc = transactionToDoc(tx)
    expect(doc.source).toBe('bank')
    expect(parseTransaction('bk_1', doc)).toEqual(tx)
  })
  it('a manual operation has neither', () => {
    const { bank: _bank, ...manual } = tx
    const doc = transactionToDoc(manual)
    expect('source' in doc).toBe(false)
    expect(parseTransaction('bk_1', doc)?.bank).toBeUndefined()
  })
  it('drops optional bank fields that are absent (Firestore rejects undefined)', () => {
    const doc = transactionToDoc({ ...tx, bank: { accountRef: 'ba1' } })
    expect(doc.bank).toEqual({ accountRef: 'ba1' })
  })
  it('ignores a malformed bank block instead of hiding the operation', () => {
    const doc = { ...transactionToDoc(tx), bank: { entryReference: 5 } }
    expect(parseTransaction('bk_1', doc)?.bank).toBeUndefined()
  })
})
