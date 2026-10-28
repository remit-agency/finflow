import { describe, expect, it } from 'vitest'
import { toUiAccount, toUiTransaction } from '@/lib/firebase/ledger-map'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

describe('toUiAccount', () => {
  it('converts minor units to major units and keeps the organization', () => {
    const a: LedgerAccount = {
      id: 'a1',
      name: 'Main',
      type: 'bank',
      currency: 'PLN',
      color: '#00c896',
      openingMinor: 10000,
      balanceMinor: 12345,
    }
    expect(toUiAccount('org1', a)).toEqual({
      id: 'a1',
      orgId: 'org1',
      name: 'Main',
      type: 'bank',
      currency: 'PLN',
      color: '#00c896',
      balance: 123.45,
      opening: 100,
    })
  })
})

describe('toUiTransaction', () => {
  const base: LedgerTransaction = {
    id: 't1',
    type: 'transfer',
    status: 'actual',
    accountId: 'a1',
    amountMinor: 2500,
    currency: 'PLN',
    toAccountId: 'a2',
    toAmountMinor: 1000,
    toCurrency: 'EUR',
    paymentDate: '2026-10-20',
    accrual: { mode: 'date', date: '2026-10-20' },
    isRecurring: false,
    tags: [],
    fileUrls: [],
  }

  it('maps a transfer with its destination amount and the payment date', () => {
    const ui = toUiTransaction('org1', base)
    expect(ui.orgId).toBe('org1')
    expect(ui.amount).toBe(25)
    expect(ui.toAccountId).toBe('a2')
    expect(ui.toAmount).toBe(10)
    expect(ui.toCurrency).toBe('EUR')
    expect(ui.date).toEqual(new Date('2026-10-20T00:00:00Z'))
    expect(ui.accrual).toEqual({ mode: 'date', date: '2026-10-20' })
  })

  it('leaves absent optional fields absent', () => {
    const ui = toUiTransaction('org1', base)
    for (const key of ['categoryId', 'counterpartyId', 'description', 'projectId']) {
      expect(key in ui).toBe(false)
    }
  })

  it('carries the bank block to the UI transaction and leaves a manual one without it', () => {
    const { toAccountId, toAmountMinor, toCurrency, ...expense } = base
    void toAccountId
    void toAmountMinor
    void toCurrency
    const bank = { accountRef: 'ba1', counterpartyName: 'ACME' }
    expect(toUiTransaction('org1', { ...expense, type: 'expense', bank }).bank).toEqual(bank)
    expect('bank' in toUiTransaction('org1', { ...expense, type: 'expense' })).toBe(false)
  })

  it('does not add destination fields to an income', () => {
    const { toAccountId, toAmountMinor, toCurrency, ...rest } = base
    void toAccountId
    void toAmountMinor
    void toCurrency
    const ui = toUiTransaction('org1', { ...rest, type: 'income', categoryId: 'c1' })
    expect(ui.categoryId).toBe('c1')
    expect('toAccountId' in ui).toBe(false)
    expect('toAmount' in ui).toBe(false)
    expect('toCurrency' in ui).toBe(false)
  })
})
