import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'

const BASE = { type: 'expense', accountId: 'acc1', amountMinor: 1234, paymentDate: '2026-10-20' }
const BANK_ID = 'bk_0123456789abcdef0123456789abcdef'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('the bk_ client id prefix is reserved for bank operations', () => {
  it('a client id with the bank prefix is refused by default (a client can never pick a bank key)', () => {
    expect(code(() => parseTransactionInput({ ...BASE, clientId: BANK_ID }))).toBe('invalid_input:clientId')
  })

  it('an internal call lets the bank prefix through; the ledger still checks the bank mark', () => {
    expect(parseTransactionInput({ ...BASE, clientId: BANK_ID }, { internal: true }).clientId).toBe(BANK_ID)
  })

  it('an internal call does not relax any other rule', () => {
    expect(code(() => parseTransactionInput({ ...BASE, clientId: 'bk_x' }, { internal: true }))).toBe('invalid_input:clientId')
  })

  it('an ordinary client id is unchanged, internal or not', () => {
    expect(parseTransactionInput({ ...BASE, clientId: 'client-12345678' }).clientId).toBe('client-12345678')
    expect(parseTransactionInput({ ...BASE, clientId: 'client-12345678' }, { internal: true }).clientId).toBe('client-12345678')
  })
})
