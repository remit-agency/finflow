import { describe, expect, it } from 'vitest'
import { judgeOp, overlapsBank } from '@/lib/domain/import/plan'
import type { ImportOp } from '@/lib/domain/import/types'

const op = (over: Partial<ImportOp> = {}): ImportOp => ({ day: '2026-10-02', type: 'expense', amountMinor: 500, reference: null, counterpartyName: null, remittance: null, ordinal: 0, ...over })
const ctx = { accountCurrency: 'PLN', statementCurrency: 'PLN', today: '2026-10-20' }

describe('judgeOp', () => {
  it('accepts an ordinary operation', () => expect(judgeOp(op(), ctx)).toBeNull())
  it('refuses a future day, a zero or huge amount, an early day, another currency', () => {
    expect(judgeOp(op({ day: '2026-10-21' }), ctx)).toBe('future_date')
    expect(judgeOp(op({ amountMinor: 0 }), ctx)).toBe('amount')
    expect(judgeOp(op({ amountMinor: 10 ** 15 }), ctx)).toBe('amount')
    expect(judgeOp(op({ day: '1999-12-31' }), ctx)).toBe('date')
    expect(judgeOp(op(), { ...ctx, statementCurrency: 'EUR' })).toBe('currency_mismatch')
    expect(judgeOp(op(), { ...ctx, statementCurrency: null })).toBe('currency_mismatch')
  })
})

describe('overlapsBank', () => {
  const bank = [{ type: 'expense' as const, amountMinor: 500, entryReference: 'EB1' }, { type: 'income' as const, amountMinor: 900, entryReference: undefined }]
  it('needs the same direction and amount', () => {
    expect(overlapsBank(op({ type: 'income' }), bank)).toBe(false)
    expect(overlapsBank(op({ amountMinor: 501 }), bank)).toBe(false)
  })
  it('needs equal references only when both have one', () => {
    expect(overlapsBank(op({ reference: null }), bank)).toBe(true)
    expect(overlapsBank(op({ reference: 'EB1' }), bank)).toBe(true)
    expect(overlapsBank(op({ reference: 'OTHER' }), bank)).toBe(false)
    expect(overlapsBank(op({ type: 'income', amountMinor: 900, reference: 'X' }), bank)).toBe(true)
  })
})
