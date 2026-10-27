import { describe, expect, it } from 'vitest'
import { attachFx, baseOf, buildTransaction, fxPlan, type BuildContext } from '@/lib/domain/ledger/build'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { RateEvidence } from '@/lib/domain/ledger/types'

const PLN = { id: 'pln', currency: 'PLN' }
const EUR = { id: 'eur', currency: 'EUR' }
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
  today: '2026-10-27',
  account: PLN,
  category: null,
  baseCurrency: 'PLN',
  ...over,
})
const input = (over: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'pln', amountMinor: 10000, paymentDate: '2026-10-20', ...over })

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

const evidence = (rate: number, requestedDate: string): RateEvidence => ({
  rate, from: 'EUR', to: 'PLN', requestedDate, rateDate: '2026-10-19', tableNo: '203/A/NBP/2026', source: 'NBP_A',
})

describe('buildTransaction', () => {
  it('takes the currency from the account', () => {
    const tx = buildTransaction('t1', input(), ctx())
    expect(tx).toMatchObject({ id: 't1', currency: 'PLN', amountMinor: 10000, status: 'actual' })
  })

  it('refuses an actual operation after today, allows a planned one', () => {
    expect(code(() => buildTransaction('t', input({ paymentDate: '2026-10-28' }), ctx()))).toBe('future_actual:paymentDate')
    expect(buildTransaction('t', input({ paymentDate: '2026-10-28', status: 'planned' }), ctx()).status).toBe('planned')
  })

  it('refuses a date more than 10 years ahead', () => {
    expect(code(() => buildTransaction('t', input({ paymentDate: '2040-01-01', status: 'planned' }), ctx()))).toBe('invalid_input:paymentDate')
    expect(code(() => buildTransaction('t', input({ accrual: { mode: 'period', from: '2036-09-01', to: '2036-12-01' } }), ctx()))).toBe('invalid_input:accrual')
  })

  it('checks that the category exists and matches the type', () => {
    expect(code(() => buildTransaction('t', input({ categoryId: 'c1' }), ctx()))).toBe('category_not_found:categoryId')
    expect(code(() => buildTransaction('t', input({ categoryId: 'c1' }), ctx({ category: { type: 'income' } })))).toBe('category_not_found:categoryId')
    expect(buildTransaction('t', input({ categoryId: 'c1' }), ctx({ category: { type: 'expense' } })).categoryId).toBe('c1')
  })

  it('builds a same-currency transfer with the same amount on both sides', () => {
    const t = parseTransactionInput({ type: 'transfer', accountId: 'pln', toAccountId: 'pln2', amountMinor: 500, paymentDate: '2026-10-20' })
    const tx = buildTransaction('t', t, ctx({ toAccount: { id: 'pln2', currency: 'PLN' } }))
    expect(tx).toMatchObject({ toAccountId: 'pln2', toAmountMinor: 500, toCurrency: 'PLN' })
  })

  it('requires the second amount for a cross-currency transfer and rejects a mismatch for the same currency', () => {
    const base = { type: 'transfer', accountId: 'pln', toAccountId: 'eur', amountMinor: 4400, paymentDate: '2026-10-20' }
    expect(code(() => buildTransaction('t', parseTransactionInput(base), ctx({ toAccount: EUR })))).toBe('invalid_input:toAmountMinor')
    const ok = buildTransaction('t', parseTransactionInput({ ...base, toAmountMinor: 1000 }), ctx({ toAccount: EUR }))
    expect(ok).toMatchObject({ toAmountMinor: 1000, toCurrency: 'EUR' })
    const same = { ...base, toAccountId: 'pln2', toAmountMinor: 5 }
    expect(code(() => buildTransaction('t', parseTransactionInput(same), ctx({ toAccount: { id: 'pln2', currency: 'PLN' } })))).toBe('invalid_input:toAmountMinor')
  })

  it('refuses a transfer to the same account or without the target account', () => {
    const t = parseTransactionInput({ type: 'transfer', accountId: 'pln', toAccountId: 'pln', amountMinor: 5, paymentDate: '2026-10-20' })
    expect(code(() => buildTransaction('t', t, ctx({ toAccount: PLN })))).toBe('invalid_input:toAccountId')
    expect(code(() => buildTransaction('t', t, ctx()))).toBe('account_not_found:toAccountId')
  })
})

describe('fxPlan / attachFx / baseOf', () => {
  const eurCtx = ctx({ account: EUR })
  const eurTx = (over: Record<string, unknown> = {}) => buildTransaction('t', input({ accountId: 'eur', amountMinor: 1000, ...over }), eurCtx)

  it('needs no rates for the company currency, transfers and planned operations', () => {
    expect(fxPlan(buildTransaction('t', input(), ctx()), 'PLN', '2026-10-27')).toEqual([])
    expect(fxPlan(eurTx({ status: 'planned' }), 'PLN', '2026-10-27')).toEqual([])
  })

  it('asks one rate when the dates coincide', () => {
    expect(fxPlan(eurTx(), 'PLN', '2026-10-27')).toEqual([{ keys: ['payment', 'accrual'], from: 'EUR', to: 'PLN', date: '2026-10-20' }])
  })

  it('asks two rates when the accrual date differs, and caps the accrual date at today', () => {
    const plan = fxPlan(eurTx({ accrual: { mode: 'date', date: '2026-10-10' } }), 'PLN', '2026-10-27')
    expect(plan).toEqual([
      { keys: ['payment'], from: 'EUR', to: 'PLN', date: '2026-10-20' },
      { keys: ['accrual'], from: 'EUR', to: 'PLN', date: '2026-10-10' },
    ])
    const future = fxPlan(eurTx({ accrual: { mode: 'period', from: '2026-11-01', to: '2026-12-31' } }), 'PLN', '2026-10-27')
    expect(future[1]).toEqual({ keys: ['accrual'], from: 'EUR', to: 'PLN', date: '2026-10-27' })
  })

  it('attachFx stores the evidence and the base amounts', () => {
    const tx = eurTx({ accrual: { mode: 'date', date: '2026-10-10' } })
    const plan = fxPlan(tx, 'PLN', '2026-10-27')
    const out = attachFx(tx, plan, [evidence(4.4026, '2026-10-20'), evidence(4.3, '2026-10-10')])
    expect(out.base).toEqual({ payment: 4403, accrual: 4300 })
    expect(out.fx?.payment?.rate).toBe(4.4026)
    expect(out.fx?.accrual?.rate).toBe(4.3)
  })

  it('attachFx with an empty plan clears fx and base', () => {
    const tx = { ...eurTx(), fx: { payment: evidence(4, 'x') }, base: { payment: 1, accrual: 1 } }
    const out = attachFx(tx, [], [])
    expect(out).not.toHaveProperty('fx')
    expect(out).not.toHaveProperty('base')
  })

  it('baseOf is the amount itself in the company currency and null when base amounts are missing', () => {
    expect(baseOf(buildTransaction('t', input(), ctx()), 'PLN')).toEqual({ payment: 10000, accrual: 10000 })
    expect(baseOf(eurTx(), 'PLN')).toBeNull()
  })
})
