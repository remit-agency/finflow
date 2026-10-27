import { describe, expect, it } from 'vitest'
import { accountToDoc, parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

const tx: LedgerTransaction = {
  id: 't1',
  type: 'expense',
  status: 'actual',
  accountId: 'a1',
  amountMinor: 1000,
  currency: 'EUR',
  paymentDate: '2026-10-20',
  accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
  categoryId: 'c1',
  description: 'rent',
  isRecurring: false,
  tags: ['x'],
  fileUrls: [],
  fx: {
    payment: { rate: 4.4, from: 'EUR', to: 'PLN', requestedDate: '2026-10-20', rateDate: '2026-10-19', tableNo: '1/A/NBP/2026', source: 'NBP_A' },
    accrual: { rate: 4.3, from: 'EUR', to: 'PLN', requestedDate: '2026-10-01', rateDate: '2026-09-30', tableNo: '2/A/NBP/2026', source: 'NBP_A' },
  },
  base: { payment: 4400, accrual: 4300 },
}

describe('transaction documents', () => {
  it('round-trips and never emits undefined', () => {
    const doc = transactionToDoc(tx)
    expect(doc.schemaVersion).toBe(2)
    expect(Object.values(doc).includes(undefined)).toBe(false)
    expect(parseTransaction('t1', doc)).toEqual(tx)
  })

  it('round-trips a transfer and ignores counterpartyId on it', () => {
    const t: LedgerTransaction = {
      id: 't2', type: 'transfer', status: 'actual', accountId: 'a', amountMinor: 4400, currency: 'PLN',
      toAccountId: 'b', toAmountMinor: 1000, toCurrency: 'EUR', paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
    }
    const doc = { ...transactionToDoc(t), counterpartyId: 'legacy-to-account' }
    expect(parseTransaction('t2', doc)).toEqual(t)
  })

  it.each([
    ['schema 1', { schemaVersion: 1 }],
    ['no schema', { schemaVersion: undefined }],
    ['a bad type', { type: 'x' }],
    ['a fractional amount', { amountMinor: 1.5 }],
    ['a bad date', { paymentDate: '2026-13-01' }],
    ['a bad accrual', { accrual: { mode: 'date' } }],
    ['a transfer without a target', { type: 'transfer', toAccountId: undefined }],
  ])('returns null for %s', (_l, patch) => {
    expect(parseTransaction('t1', { ...transactionToDoc(tx), ...patch })).toBeNull()
  })

  it('returns null for a non-object', () => {
    expect(parseTransaction('t1', null)).toBeNull()
    expect(parseTransaction('t1', 'x')).toBeNull()
  })
})

describe('account documents', () => {
  const acc: LedgerAccount = { id: 'a1', name: 'Main', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 100, balanceMinor: 250 }
  it('round-trips', () => {
    expect(parseAccount('a1', accountToDoc(acc))).toEqual(acc)
  })
  it('returns null for a legacy account', () => {
    expect(parseAccount('a1', { name: 'x', balance: 5, currency: 'PLN' })).toBeNull()
  })
})
