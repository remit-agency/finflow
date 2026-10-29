import { describe, expect, it } from 'vitest'
import { assertBankUnlocked } from '@/lib/domain/ledger/bank-lock'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const base: LedgerTransaction = {
  id: 'bk_1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
  bank: { accountRef: 'ba1' },
}

describe('assertBankUnlocked', () => {
  it('allows changes to category, counterparty, description, accrual', () => {
    expect(() => assertBankUnlocked(base, { ...base, categoryId: 'k1', counterpartyId: 'c1', description: 'x', accrual: { mode: 'date', date: '2026-10-25' } })).not.toThrow()
  })
  it.each([
    ['amountMinor', { amountMinor: 1001 }],
    ['paymentDate', { paymentDate: '2026-10-21' }],
    ['accountId', { accountId: 'a2' }],
    ['type', { type: 'income' as const }],
    ['status', { status: 'planned' as const }],
  ])('rejects a change of %s with bank_locked and names the field', (field, change) => {
    try {
      assertBankUnlocked(base, { ...base, ...change })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerError)
      expect((e as LedgerError).code).toBe('bank_locked')
      expect((e as LedgerError).field).toBe(field)
    }
  })
})
