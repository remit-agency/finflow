import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { applyPatch, fullPatch, parseTransactionInput, parseTransactionPatch, toRawInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const BASE = { type: 'expense', accountId: 'acc1', amountMinor: 1234, paymentDate: '2026-10-20' }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

describe('parseTransactionInput', () => {
  it('fills the defaults', () => {
    expect(parseTransactionInput(BASE)).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'acc1',
      amountMinor: 1234,
      paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' },
      isRecurring: false,
      tags: [],
      fileUrls: [],
    })
  })

  it('keeps optional fields and trims the description', () => {
    const out = parseTransactionInput({
      ...BASE,
      categoryId: 'cat1',
      counterpartyId: 'cp1',
      description: '  rent  ',
      projectId: 'p1',
      tags: ['a'],
      isRecurring: true,
      clientId: 'client-12345678',
    })
    expect(out).toMatchObject({
      categoryId: 'cat1',
      counterpartyId: 'cp1',
      description: 'rent',
      projectId: 'p1',
      tags: ['a'],
      isRecurring: true,
      clientId: 'client-12345678',
    })
  })

  it('parses a period accrual', () => {
    const out = parseTransactionInput({ ...BASE, accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' } })
    expect(out.accrual).toEqual({ mode: 'period', from: '2026-10-01', to: '2026-12-31' })
  })

  it('parses a transfer', () => {
    const out = parseTransactionInput({ type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, toAmountMinor: 7, paymentDate: '2026-10-20' })
    expect(out).toMatchObject({ type: 'transfer', toAccountId: 'b', toAmountMinor: 7, accrual: { mode: 'date', date: '2026-10-20' } })
  })

  it.each([
    ['a non-object body', 'x', 'invalid_input:body'],
    ['an unknown key', { ...BASE, nope: 1 }, 'invalid_input:nope'],
    ['a bad type', { ...BASE, type: 'refund' }, 'invalid_input:type'],
    ['a bad status', { ...BASE, status: 'done' }, 'invalid_input:status'],
    ['a zero amount', { ...BASE, amountMinor: 0 }, 'invalid_input:amountMinor'],
    ['a fractional amount', { ...BASE, amountMinor: 1.5 }, 'invalid_input:amountMinor'],
    ['a string amount', { ...BASE, amountMinor: '5' }, 'invalid_input:amountMinor'],
    ['an amount over the cap', { ...BASE, amountMinor: 10 ** 13 + 1 }, 'invalid_input:amountMinor'],
    ['a bad account id', { ...BASE, accountId: 'a/b' }, 'invalid_input:accountId'],
    ['a reserved id', { ...BASE, accountId: '__x__' }, 'invalid_input:accountId'],
    ['an impossible date', { ...BASE, paymentDate: '2026-02-30' }, 'invalid_input:paymentDate'],
    ['a date before 2000', { ...BASE, paymentDate: '1999-12-31' }, 'invalid_input:paymentDate'],
    ['an unknown accrual mode', { ...BASE, accrual: { mode: 'x' } }, 'invalid_input:accrual.mode'],
    ['a reversed period', { ...BASE, accrual: { mode: 'period', from: '2026-10-05', to: '2026-10-01' } }, 'invalid_input:accrual.to'],
    ['a period over 36 months', { ...BASE, accrual: { mode: 'period', from: '2026-01-01', to: '2029-02-01' } }, 'invalid_input:accrual.to'],
    ['an extra accrual key', { ...BASE, accrual: { mode: 'date', date: '2026-10-20', x: 1 } }, 'invalid_input:accrual.x'],
    ['a long description', { ...BASE, description: 'x'.repeat(501) }, 'invalid_input:description'],
    ['too many tags', { ...BASE, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'invalid_input:tags'],
    ['a short clientId', { ...BASE, clientId: 'abc' }, 'invalid_input:clientId'],
    ['a transfer without a target', { type: 'transfer', accountId: 'a', amountMinor: 5, paymentDate: '2026-10-20' }, 'invalid_input:toAccountId'],
    ['a transfer with a category', { type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, paymentDate: '2026-10-20', categoryId: 'c' }, 'invalid_input:categoryId'],
    ['a transfer with an accrual', { type: 'transfer', accountId: 'a', toAccountId: 'b', amountMinor: 5, paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' } }, 'invalid_input:accrual'],
    ['an expense with a target account', { ...BASE, toAccountId: 'b' }, 'invalid_input:toAccountId'],
  ])('rejects %s', (_label, body, expected) => {
    expect(code(() => parseTransactionInput(body))).toBe(expected)
  })
})

describe('patches', () => {
  const existing: LedgerTransaction = {
    id: 't1',
    type: 'expense',
    status: 'actual',
    accountId: 'acc1',
    amountMinor: 1234,
    currency: 'PLN',
    paymentDate: '2026-10-20',
    accrual: { mode: 'date', date: '2026-10-20' },
    categoryId: 'cat1',
    description: 'old',
    isRecurring: false,
    tags: [],
    fileUrls: [],
  }

  it('toRawInput omits an accrual that just follows the payment date', () => {
    expect(toRawInput(existing)).not.toHaveProperty('accrual')
    const spread = { ...existing, accrual: { mode: 'date' as const, date: '2026-09-01' } }
    expect(toRawInput(spread)).toHaveProperty('accrual', { mode: 'date', date: '2026-09-01' })
  })

  it('toRawInput leaves out the target amount of a same-currency transfer but keeps a cross-currency one', () => {
    const transfer: LedgerTransaction = { ...existing, type: 'transfer', categoryId: undefined, toAccountId: 'b', toAmountMinor: 1234, toCurrency: 'PLN' }
    expect(toRawInput(transfer)).not.toHaveProperty('toAmountMinor')
    expect(toRawInput({ ...transfer, toAmountMinor: 300, toCurrency: 'EUR' })).toHaveProperty('toAmountMinor', 300)
  })

  it('parseTransactionPatch needs at least one key and allows null only where optional', () => {
    expect(code(() => parseTransactionPatch({}))).toBe('invalid_input:body')
    expect(code(() => parseTransactionPatch({ amountMinor: null }))).toBe('invalid_input:amountMinor')
    expect(code(() => parseTransactionPatch({ clientId: 'abcdefgh' }))).toBe('invalid_input:clientId')
    expect(parseTransactionPatch({ categoryId: null })).toEqual({ categoryId: null })
  })

  it('applyPatch merges, clears with null, and follows the payment date', () => {
    const next = applyPatch(toRawInput(existing), { amountMinor: 1235, description: null, paymentDate: '2026-10-21' })
    expect(next.amountMinor).toBe(1235)
    expect(next).not.toHaveProperty('description')
    expect(next.paymentDate).toBe('2026-10-21')
    expect(next.accrual).toEqual({ mode: 'date', date: '2026-10-21' })
    expect(next.categoryId).toBe('cat1')
  })

  it('applyPatch revalidates the merged result', () => {
    expect(code(() => applyPatch(toRawInput(existing), { type: 'transfer' }))).toBe('invalid_input:toAccountId')
  })

  it('fullPatch nulls the absent optional fields and passes parseTransactionPatch', () => {
    const patch = fullPatch({ type: 'income', status: 'actual', accountId: 'a', amountMinor: 5, paymentDate: '2026-10-20', isRecurring: false, tags: [], fileUrls: [] })
    expect(patch).toMatchObject({ categoryId: null, accrual: null, description: null, toAccountId: null })
    expect(() => parseTransactionPatch(patch)).not.toThrow()
  })
})
