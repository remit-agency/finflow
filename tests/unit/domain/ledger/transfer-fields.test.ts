import { describe, expect, it } from 'vitest'
import { assertBankUnlocked, withBankSides } from '@/lib/domain/ledger/bank-lock'
import { changeSet } from '@/lib/domain/ledger/change'
import { daysApart } from '@/lib/domain/ledger/days'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects, datedEffects, receivedOn } from '@/lib/domain/ledger/effects'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { contributions } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const OUT_KEY = 'a'.repeat(32)
const IN_KEY = 'b'.repeat(32)

/** 1000 zł from the Millennium account to the Monobank one: both sides from the banks, the money arrived two days later. */
const pair: LedgerTransaction = {
  id: `bk_${OUT_KEY}`, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
  toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14',
  paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: [], fileUrls: [],
  bank: { accountRef: 'ba-mil', entryReference: 'r-out', counterpartyName: 'Własne', remittance: 'Przelew' },
  bankTo: { key: IN_KEY, accountRef: 'ba-mono', entryReference: 'r-in', remittance: 'Przelew' },
}

/** 300 zł from the cash box into the bank: only the incoming side came from a bank (a converted income). */
const deposit: LedgerTransaction = {
  id: `bk_${IN_KEY}`, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
  toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
  bankTo: { key: IN_KEY, accountRef: 'ba-mil' },
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('the transfer fields in the operation document (S10b)', () => {
  it('round-trips the arrival day and both bank sides; only an outgoing bank side marks the source', () => {
    const doc = transactionToDoc(pair)
    expect(doc).toMatchObject({
      source: 'bank',
      toDate: '2026-10-14',
      bankTo: { key: IN_KEY, accountRef: 'ba-mono', entryReference: 'r-in', remittance: 'Przelew' },
    })
    expect(parseTransaction(pair.id, doc)).toEqual(pair)
    const depositDoc = transactionToDoc(deposit)
    expect('source' in depositDoc).toBe(false)
    expect('toDate' in depositDoc).toBe(false)
    expect(parseTransaction(deposit.id, depositDoc)).toEqual(deposit)
  })

  it.each([
    ['an arrival day that is not a day', { toDate: '2026-10-32' }],
    ['a bankTo without a key', { bankTo: { accountRef: 'ba-mono' } }],
    ['a bankTo whose key is not a document id', { bankTo: { key: 'a/b', accountRef: 'ba-mono' } }],
    ['a bankTo without its bank account', { bankTo: { key: IN_KEY } }],
    ['a bankTo that is not a map', { bankTo: 'ba-mono' }],
  ])('a transfer with %s is unreadable', (_name, change) => {
    expect(parseTransaction(pair.id, { ...transactionToDoc(pair), ...change })).toBeNull()
  })

  it('an income or an expense with an arrival day or an incoming bank side is unreadable', () => {
    const income: LedgerTransaction = {
      id: `bk_${OUT_KEY}`, type: 'income', status: 'actual', accountId: 'mil', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
    }
    const doc = transactionToDoc(income)
    expect(parseTransaction(income.id, doc)).not.toBeNull()
    expect(parseTransaction(income.id, { ...doc, toDate: '2026-10-21' })).toBeNull()
    expect(parseTransaction(income.id, { ...doc, bankTo: { key: IN_KEY, accountRef: 'ba-mil' } })).toBeNull()
  })
})

describe('the arrival day of a transfer', () => {
  it('is its own toDate, else the payment day', () => {
    expect(receivedOn(pair)).toBe('2026-10-14')
    expect(receivedOn(deposit)).toBe('2026-10-20')
  })

  it('dates the money in; the balance effects add up the same per account; a planned transfer moves nothing', () => {
    expect(datedEffects(pair)).toEqual([
      { accountId: 'mil', day: '2026-10-12', delta: -100_000 },
      { accountId: 'mono', day: '2026-10-14', delta: 100_000 },
    ])
    expect(balanceEffects(pair)).toEqual({ mil: -100_000, mono: 100_000 })
    expect(datedEffects({ ...pair, status: 'planned' })).toEqual([])
    expect(balanceEffects({ ...pair, status: 'planned' })).toEqual({})
  })

  it('puts the transfer in of the target on the arrival day, in the x_ twin when the transfer is excluded', () => {
    expect([...contributions(pair, 'PLN')]).toEqual([
      ['cash_mil_2026-10-12', { transferOutMinor: 100_000 }],
      ['cash_mono_2026-10-14', { transferInMinor: 100_000 }],
    ])
    expect([...contributions({ ...pair, excluded: true }, 'PLN')]).toEqual([
      ['x_cash_mil_2026-10-12', { transferOutMinor: 100_000 }],
      ['x_cash_mono_2026-10-14', { transferInMinor: 100_000 }],
    ])
    expect([...contributions(deposit, 'PLN')]).toEqual([
      ['cash_cash_2026-10-20', { transferOutMinor: 30_000 }],
      ['cash_mil_2026-10-20', { transferInMinor: 30_000 }],
    ])
  })

  it('moving the arrival day moves only the rollup of the target and no balance', () => {
    const later: LedgerTransaction = { ...pair, toDate: '2026-10-15' }
    const change = changeSet(pair, later, 'PLN')
    expect([...change.rollupDeltas]).toEqual([
      ['cash_mono_2026-10-15', { transferInMinor: 100_000 }],
      ['cash_mono_2026-10-14', { transferInMinor: -100_000 }],
    ])
    expect(change.balanceDeltas).toEqual({})
  })

  it('daysApart counts whole days in either order', () => {
    expect(daysApart('2026-10-12', '2026-10-14')).toBe(2)
    expect(daysApart('2026-10-14', '2026-10-12')).toBe(2)
    expect(daysApart('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysApart('2026-10-12', '2026-10-12')).toBe(0)
  })
})

describe('the bank lock of a transfer (S10b)', () => {
  it('lets the comment, the tags and the account of a side that is not from a bank change', () => {
    expect(code(() => assertBankUnlocked(pair, { ...pair, description: 'Własny', tags: ['q4'] }))).toBe('ok')
    expect(code(() => assertBankUnlocked(deposit, { ...deposit, accountId: 'cash2' }))).toBe('ok')
  })

  it.each([
    ['type', { type: 'expense' as const }],
    ['status', { status: 'planned' as const }],
    ['accountId', { accountId: 'other' }],
    ['amountMinor', { amountMinor: 99_999 }],
    ['paymentDate', { paymentDate: '2026-10-13' }],
    ['toAccountId', { toAccountId: 'other' }],
    ['toAmountMinor', { toAmountMinor: 99_999 }],
    ['toDate', { toDate: '2026-10-15' }],
  ])('a transfer from bank to bank refuses a change of %s', (field, change) => {
    expect(code(() => assertBankUnlocked(pair, { ...pair, ...change }))).toBe(`bank_locked:${field}`)
  })

  it.each([
    ['type', { type: 'income' as const }],
    ['toAccountId', { toAccountId: 'other' }],
    ['toAmountMinor', { toAmountMinor: 1 }],
    ['paymentDate', { paymentDate: '2026-10-21' }],
  ])('a deposit refuses a change of %s (its arrival day is the payment day)', (field, change) => {
    expect(code(() => assertBankUnlocked(deposit, { ...deposit, ...change }))).toBe(`bank_locked:${field}`)
  })

  it('withBankSides gives an edited transfer back its bank blocks and its arrival day', () => {
    const edited: LedgerTransaction = { ...pair, description: 'x' }
    delete edited.bank
    delete edited.bankTo
    delete edited.toDate
    expect(withBankSides(edited, pair)).toEqual({ ...pair, description: 'x' })
  })
})
