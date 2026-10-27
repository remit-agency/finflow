import { describe, expect, it } from 'vitest'
import { computeLedger } from '@/lib/domain/ledger/expected'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'

const acc = (id: string, openingMinor: number, currency = 'PLN'): LedgerAccount => ({
  id, name: id, type: 'bank', currency, color: '#000000', openingMinor, balanceMinor: openingMinor,
})
const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'income', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})

describe('computeLedger', () => {
  it('the screenshot case: 1234,60 of income, +10 and -10 ends at 1234,60', () => {
    const out = computeLedger(
      [acc('a', 0)],
      [tx({ id: '1', amountMinor: 123460 }), tx({ id: '2', amountMinor: 1000 }), tx({ id: '3', type: 'expense', amountMinor: 1000 })],
      'PLN',
    )
    expect(out.balances.a).toBe(123460)
  })

  it('counts a transfer on both accounts and ignores planned operations', () => {
    const out = computeLedger(
      [acc('a', 5000), acc('b', 0, 'EUR')],
      [
        tx({ id: '1', type: 'transfer', amountMinor: 4400, toAccountId: 'b', toAmountMinor: 1000, toCurrency: 'EUR' }),
        tx({ id: '2', status: 'planned', amountMinor: 999 }),
      ],
      'PLN',
    )
    expect(out.balances).toEqual({ a: 600, b: 1000 })
    expect(out.rollups.size).toBe(2)
  })

  it('reports operations it cannot count and leaves them out', () => {
    const out = computeLedger([acc('a', 0)], [tx({ id: 'x', accountId: 'ghost' }), tx({ id: 'y', currency: 'EUR' })], 'PLN')
    expect(out.invalid).toEqual(['x', 'y'])
    expect(out.balances).toEqual({ a: 0 })
  })

  it('treats an account id that is a member of Object.prototype as unknown unless it exists, and counts it when it does', () => {
    const missing = computeLedger([acc('a', 0)], [tx({ id: 'x', accountId: 'toString' }), tx({ id: 'y', accountId: 'constructor' })], 'PLN')
    expect(missing.invalid).toEqual(['x', 'y'])
    expect(missing.balances).toEqual({ a: 0 })

    const present = computeLedger([acc('constructor', 100)], [tx({ id: 'z', accountId: 'constructor', amountMinor: 50 })], 'PLN')
    expect(present.invalid).toEqual([])
    expect(present.balances.constructor).toBe(150)
  })
})
