import { describe, expect, it } from 'vitest'
import { arrivalShiftOf } from '@/lib/domain/journal/balance'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const transfer = (paymentDate: string, toDate?: string, status: 'actual' | 'planned' = 'actual'): LedgerTransaction => ({
  id: 'bk_1', type: 'transfer', status, accountId: 'mil', amountMinor: 100, currency: 'PLN', toAccountId: 'mono',
  toAmountMinor: 90, toCurrency: 'PLN', paymentDate, accrual: { mode: 'date', date: paymentDate }, isRecurring: false,
  tags: [], fileUrls: [], ...(toDate === undefined ? {} : { toDate }),
})

describe('arrivalShiftOf (S10b)', () => {
  it('adds the money in when it left on or before the day and arrived after it', () => {
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-12')).toBe(90)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-13')).toBe(90)
  })

  it('takes it off when it left after the day but arrived on or before it', () => {
    expect(arrivalShiftOf(transfer('2026-10-17', '2026-10-16'), '2026-10-16')).toBe(-90)
  })

  it('is 0 when both days are on one side of the day, without an arrival day, and for a planned transfer', () => {
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-14')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-11')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-17', '2026-10-16'), '2026-10-17')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12'), '2026-10-12')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14', 'planned'), '2026-10-13')).toBe(0)
  })
})
