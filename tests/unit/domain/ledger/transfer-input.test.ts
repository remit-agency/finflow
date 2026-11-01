import { describe, expect, it } from 'vitest'
import { buildTransaction } from '@/lib/domain/ledger/build'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const PAIR = { clientId: `bk_${A}`, type: 'transfer', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' }
const INTERNAL = { internal: true }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('the restore keys of a bank transfer (S10b)', () => {
  it('the undo of a deleted bank transfer may bring its arrival day and the key of its incoming bank side', () => {
    expect(parseTransactionInput({ ...PAIR, toDate: '2026-10-14', bankToKey: B }, INTERNAL)).toMatchObject({ toDate: '2026-10-14', bankToKey: B })
    const sameDay = parseTransactionInput({ ...PAIR, bankToKey: B }, INTERNAL)
    expect(sameDay.bankToKey).toBe(B)
    expect(sameDay.toDate).toBeUndefined()
  })

  it.each<[string, Record<string, unknown>, { internal?: boolean } | undefined, string]>([
    ['without the internal flag the bank id itself is refused', { ...PAIR, bankToKey: B }, undefined, 'invalid_input:clientId'],
    ['under an ordinary id', { ...PAIR, clientId: 'manual-12345678', bankToKey: B }, INTERNAL, 'invalid_input:bankToKey'],
    ['an arrival day without the incoming key', { ...PAIR, toDate: '2026-10-14' }, INTERNAL, 'invalid_input:bankToKey'],
    ['its own key as the incoming key', { ...PAIR, bankToKey: A }, INTERNAL, 'invalid_input:bankToKey'],
    ['an incoming key that is not a document id', { ...PAIR, bankToKey: 'a/b' }, INTERNAL, 'invalid_input:bankToKey'],
    ['an arrival day on the payment day', { ...PAIR, toDate: '2026-10-12', bankToKey: B }, INTERNAL, 'invalid_input:toDate'],
    ['an arrival day 8 days away', { ...PAIR, toDate: '2026-10-20', bankToKey: B }, INTERNAL, 'invalid_input:toDate'],
    ['an arrival day on an income', { clientId: `bk_${A}`, type: 'income', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-12', toDate: '2026-10-13' }, INTERNAL, 'invalid_input:toDate'],
    ['an incoming key on an expense', { clientId: `bk_${A}`, type: 'expense', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-12', bankToKey: B }, INTERNAL, 'invalid_input:bankToKey'],
  ])('refuses %s', (_name, body, opts, expected) => {
    expect(code(() => parseTransactionInput(body, opts))).toBe(expected)
  })

  it('an edit never takes them', () => {
    expect(code(() => parseTransactionPatch({ toDate: '2026-10-14' }))).toBe('invalid_input:toDate')
    expect(code(() => parseTransactionPatch({ bankToKey: B }))).toBe('invalid_input:bankToKey')
  })

  it('the build keeps the arrival day of the input', () => {
    const input = parseTransactionInput({ ...PAIR, toDate: '2026-10-14', bankToKey: B }, INTERNAL)
    const tx = buildTransaction(PAIR.clientId, input, {
      today: '2026-10-27',
      account: { id: 'mil', currency: 'PLN' },
      toAccount: { id: 'mono', currency: 'PLN' },
      category: null,
      baseCurrency: 'PLN',
    })
    expect(tx.toDate).toBe('2026-10-14')
  })
})
