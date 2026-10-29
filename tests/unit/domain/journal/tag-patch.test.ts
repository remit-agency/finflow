import { describe, expect, it } from 'vitest'
import { isTagPatch, splitByPatch } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (id: string, over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id, type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-10', accrual: { mode: 'date', date: '2026-10-10' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})

describe('a bulk tag change (S10t)', () => {
  it('is told apart from a field change', () => {
    expect(isTagPatch({ addTagIds: ['vat'] })).toBe(true)
    expect(isTagPatch({ removeTagIds: ['vat'] })).toBe(true)
    expect(isTagPatch({ description: 'x' })).toBe(false)
  })

  it('applies to every row, transfers included, and skips nothing', () => {
    const rows = [tx('a'), tx('b', { type: 'transfer', toAccountId: 'a2', toAmountMinor: 1000, toCurrency: 'PLN' })]
    expect(splitByPatch(rows, { addTagIds: ['vat'] }, '2026-10-27')).toEqual({ apply: rows, skipped: [] })
  })
})
