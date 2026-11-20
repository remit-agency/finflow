import { describe, expect, it } from 'vitest'
import { judgeOp, takeBankMatch, type BankOpView } from '@/lib/domain/import/plan'
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

describe('takeBankMatch', () => {
  const bank = (): BankOpView[] => [
    { type: 'expense' as const, amountMinor: 500, entryReference: 'EB1' },
    { type: 'income' as const, amountMinor: 900, entryReference: undefined },
  ]
  it('needs the same direction and amount', () => {
    expect(takeBankMatch(op({ type: 'income' }), bank())).toBe(false)
    expect(takeBankMatch(op({ amountMinor: 501 }), bank())).toBe(false)
  })
  it('needs equal references only when both have one', () => {
    expect(takeBankMatch(op({ reference: null }), bank())).toBe(true)
    expect(takeBankMatch(op({ reference: 'EB1' }), bank())).toBe(true)
    expect(takeBankMatch(op({ reference: 'OTHER' }), bank())).toBe(false)
    expect(takeBankMatch(op({ type: 'income', amountMinor: 900, reference: 'X' }), bank())).toBe(true)
  })
  it('takes the matched bank operation out, so one bank operation covers one line only', () => {
    const ops = bank()
    expect(takeBankMatch(op(), ops)).toBe(true)
    expect(ops.map((b) => b.amountMinor)).toEqual([900])
    expect(takeBankMatch(op(), ops)).toBe(false)
  })
  it('leaves the list alone when nothing matches', () => {
    const ops = bank()
    expect(takeBankMatch(op({ amountMinor: 1 }), ops)).toBe(false)
    expect(ops).toHaveLength(2)
  })
})
