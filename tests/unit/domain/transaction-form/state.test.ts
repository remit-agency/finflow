import { describe, expect, it } from 'vitest'
import { emptyAccrual } from '@/lib/domain/transaction-form/accrual'
import { initialFormState, isDirty, validateState, type FormState } from '@/lib/domain/transaction-form/state'
import type { Transaction } from '@/types'

const TODAY = '2026-10-28'
const fmt = (n: number) => String(n).replace('.', ',')

const fresh = (over: Partial<Parameters<typeof initialFormState>[0]> = {}): FormState =>
  initialFormState({ defaultType: 'expense', defaultAccountId: 'a1', today: TODAY, formatAmount: fmt, ...over })

const stored = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  orgId: 'o1',
  accountId: 'a1',
  type: 'expense',
  status: 'actual',
  amount: 120.5,
  currency: 'PLN',
  date: new Date('2026-10-20T00:00:00Z'),
  accrual: { mode: 'date', date: '2026-10-20' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

describe('initialFormState', () => {
  it('a new operation: actual, today, the first account, nothing typed, accrual off', () => {
    expect(fresh()).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      toAccountId: '',
      amount: '',
      toAmount: '',
      categoryId: '',
      counterpartyId: '',
      paymentDate: TODAY,
      accrual: emptyAccrual(TODAY),
      description: '',
      isRecurring: false,
    })
  })

  it('a stored operation fills every field, with amounts formatted for the input', () => {
    const state = fresh({
      transaction: stored({ categoryId: 'c1', counterpartyId: 'cp1', description: 'Czynsz', status: 'planned' }),
    })
    expect(state).toMatchObject({
      type: 'expense',
      status: 'planned',
      accountId: 'a1',
      amount: '120,5',
      categoryId: 'c1',
      counterpartyId: 'cp1',
      paymentDate: '2026-10-20',
      description: 'Czynsz',
    })
    expect(state.accrual).toEqual(emptyAccrual('2026-10-20'))
  })

  it('a stored period accrual switches the date section on in period mode', () => {
    const state = fresh({ transaction: stored({ accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' } }) })
    expect(state.accrual).toMatchObject({ on: true, mode: 'period', from: '2026-10-01', to: '2026-12-31' })
  })

  it('a stored transfer keeps both accounts and amounts and has no accrual', () => {
    const state = fresh({
      transaction: stored({ type: 'transfer', toAccountId: 'a2', toAmount: 28, toCurrency: 'EUR', currency: 'PLN' }),
    })
    expect(state).toMatchObject({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amount: '120,5', toAmount: '28' })
    expect(state.accrual.on).toBe(false)
  })
})

describe('validateState', () => {
  const ok = (over: Partial<FormState> = {}): FormState => ({ ...fresh(), amount: '10', ...over })

  it('a complete operation has no errors', () => {
    expect(validateState(ok(), { crossCurrency: false })).toEqual({})
  })

  it('requires an account and a positive amount', () => {
    expect(validateState(ok({ accountId: '' }), { crossCurrency: false })).toEqual({ accountId: 'account' })
    expect(validateState(ok({ amount: '' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
    expect(validateState(ok({ amount: '0' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
    expect(validateState(ok({ amount: 'abc' }), { crossCurrency: false })).toEqual({ amount: 'amount' })
  })

  it('requires a valid payment date', () => {
    expect(validateState(ok({ paymentDate: '' }), { crossCurrency: false })).toEqual({ paymentDate: 'paymentDate' })
    expect(validateState(ok({ paymentDate: '1999-01-01' }), { crossCurrency: false })).toEqual({ paymentDate: 'paymentDate' })
  })

  it('a transfer needs another account, and the second amount when the currencies differ', () => {
    const transfer = ok({ type: 'transfer', toAccountId: '' })
    expect(validateState(transfer, { crossCurrency: false })).toEqual({ toAccountId: 'toAccount' })
    expect(validateState({ ...transfer, toAccountId: 'a1' }, { crossCurrency: false })).toEqual({ toAccountId: 'sameAccount' })
    expect(validateState({ ...transfer, toAccountId: 'a2' }, { crossCurrency: true })).toEqual({ toAmount: 'amountTo' })
    expect(validateState({ ...transfer, toAccountId: 'a2', toAmount: '2,5' }, { crossCurrency: true })).toEqual({})
  })

  it('checks the accrual of an income or expense only', () => {
    const bad = { ...emptyAccrual(TODAY), on: true, mode: 'period' as const, from: '2026-12-31', to: '2026-10-01' }
    expect(validateState(ok({ accrual: bad }), { crossCurrency: false })).toEqual({ accrual: 'accrualOrder' })
    expect(validateState(ok({ type: 'transfer', toAccountId: 'a2', accrual: bad }), { crossCurrency: false })).toEqual({})
  })
})

describe('isDirty', () => {
  it('is false for an untouched form', () => {
    expect(isDirty(fresh(), fresh())).toBe(false)
  })

  it('is true as soon as any field differs', () => {
    expect(isDirty(fresh(), { ...fresh(), amount: '5' })).toBe(true)
    expect(isDirty(fresh(), { ...fresh(), accrual: { ...emptyAccrual(TODAY), on: true } })).toBe(true)
    expect(isDirty(fresh(), { ...fresh(), status: 'planned' })).toBe(true)
  })

  it('ignores whitespace around the description', () => {
    expect(isDirty({ ...fresh(), description: 'a' }, { ...fresh(), description: ' a ' })).toBe(false)
  })
})
