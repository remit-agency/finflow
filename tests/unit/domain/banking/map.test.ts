import { describe, expect, it } from 'vitest'
import { mapBankTransaction, parseDecimalMinor, pickBalance, type EbTransaction } from '@/lib/domain/banking/map'

const ctx = { bankAccountId: 'ba1', accountId: 'a1', accountCurrency: 'PLN', clientId: 'bk_00000000000000000000000000000001' }
const base: EbTransaction = {
  entry_reference: 'ref-1', booking_date: '2026-10-20', value_date: '2026-10-19',
  transaction_amount: { amount: '123.45', currency: 'PLN' }, credit_debit_indicator: 'DBIT', status: 'BOOK',
  creditor: { name: '  ACME  Sp. z o.o. ' }, debtor: { name: 'Me' }, remittance_information: ['Faktura', '12/2026'],
}

describe('parseDecimalMinor', () => {
  it.each([
    ['123.45', 12345], ['0.5', 50], ['10', 1000], ['0.00', 0], ['-7.1', -710], ['1000000.99', 100000099],
  ])('%s -> %s', (s, minor) => expect(parseDecimalMinor(s)).toBe(minor))
  it.each(['', 'abc', '1.234', '1,5', '--1', '1e3', null, 12])('%s is not an amount', (s) => expect(parseDecimalMinor(s)).toBeNull())
})

describe('mapBankTransaction', () => {
  it('a debit becomes an actual expense on the payment day with the bank text as description', () => {
    const r = mapBankTransaction(base, ctx)
    expect(r).toEqual({
      ok: true,
      input: { clientId: ctx.clientId, type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 12345, paymentDate: '2026-10-20', description: 'Faktura 12/2026' },
      bank: { accountRef: 'ba1', entryReference: 'ref-1', counterpartyName: 'ACME Sp. z o.o.', remittance: 'Faktura 12/2026' },
    })
  })
  it('a credit becomes income and the other party is the debtor', () => {
    const r = mapBankTransaction({ ...base, credit_debit_indicator: 'CRDT' }, ctx)
    expect(r.ok && r.input.type).toBe('income')
    expect(r.ok && r.bank.counterpartyName).toBe('Me')
  })
  it('falls back to value_date, then transaction_date', () => {
    const r1 = mapBankTransaction({ ...base, booking_date: null }, ctx)
    expect(r1.ok && r1.input.paymentDate).toBe('2026-10-19')
    const r2 = mapBankTransaction({ ...base, booking_date: undefined, value_date: undefined, transaction_date: '2026-10-18' }, ctx)
    expect(r2.ok && r2.input.paymentDate).toBe('2026-10-18')
  })
  it('refuses what cannot become a ledger operation', () => {
    expect(mapBankTransaction({ ...base, status: 'PDNG' }, ctx)).toEqual({ ok: false, reason: 'status' })
    expect(mapBankTransaction({ ...base, transaction_amount: { amount: '0.00', currency: 'PLN' } }, ctx)).toEqual({ ok: false, reason: 'amount' })
    expect(mapBankTransaction({ ...base, transaction_amount: { amount: 'x', currency: 'PLN' } }, ctx)).toEqual({ ok: false, reason: 'amount' })
    expect(mapBankTransaction({ ...base, transaction_amount: { amount: '5.00', currency: 'EUR' } }, ctx)).toEqual({ ok: false, reason: 'currency' })
    expect(mapBankTransaction({ ...base, booking_date: null, value_date: null }, ctx)).toEqual({ ok: false, reason: 'date' })
  })
  it('a missing status counts as booked; no text leaves the description out; long text is cut to the ledger limit', () => {
    const noStatus = mapBankTransaction({ ...base, status: undefined, remittance_information: null, note: null }, ctx)
    expect(noStatus.ok && 'description' in noStatus.input).toBe(false)
    const long = mapBankTransaction({ ...base, remittance_information: ['x'.repeat(900)] }, ctx)
    expect(long.ok && (long.input.description as string).length).toBe(500)
  })
  it('uses the note when there is no remittance information', () => {
    const r = mapBankTransaction({ ...base, remittance_information: [], note: 'Przelew własny' }, ctx)
    expect(r.ok && r.input.description).toBe('Przelew własny')
  })
})

describe('pickBalance', () => {
  const b = (type: string, amount: string, currency = 'PLN', ind?: 'CRDT' | 'DBIT') => ({ balance_type: type, balance_amount: { amount, currency }, ...(ind ? { credit_debit_indicator: ind } : {}) })
  it('prefers the closing booked balance, then interim booked, then others', () => {
    expect(pickBalance([b('ITBD', '10.00'), b('CLBD', '20.00')], 'PLN')).toEqual({ amountMinor: 2000, type: 'CLBD' })
    expect(pickBalance([b('XPCD', '5.00'), b('ITBD', '10.00')], 'PLN')).toEqual({ amountMinor: 1000, type: 'ITBD' })
    expect(pickBalance([b('XPCD', '5.00')], 'PLN')).toEqual({ amountMinor: 500, type: 'XPCD' })
  })
  it('honours a debit indicator and ignores other currencies', () => {
    expect(pickBalance([b('CLBD', '20.00', 'PLN', 'DBIT')], 'PLN')).toEqual({ amountMinor: -2000, type: 'CLBD' })
    expect(pickBalance([b('CLBD', '20.00', 'EUR')], 'PLN')).toBeNull()
    expect(pickBalance([], 'PLN')).toBeNull()
  })
})
