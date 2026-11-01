import { afterEach, describe, expect, it, vi } from 'vitest'
import { bankRestoreOf, restoreTransaction } from '@/lib/api/transaction-undo'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'

const OUT_KEY = 'a'.repeat(32)
const IN_KEY = 'b'.repeat(32)
const pair: LedgerTransaction = {
  id: `bk_${OUT_KEY}`, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
  toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14',
  paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['q4'], fileUrls: [],
  bank: { accountRef: 'ba-mil' }, bankTo: { key: IN_KEY, accountRef: 'ba-mono' },
}
const deposit: LedgerTransaction = {
  id: `bk_${IN_KEY}`, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
  toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN', paymentDate: '2026-10-20',
  accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], bankTo: { key: IN_KEY, accountRef: 'ba-mil' },
}

afterEach(() => vi.unstubAllGlobals())

describe('the transfer fields in the browser (S10b)', () => {
  it('toUiTransaction carries the incoming bank side and the arrival day', () => {
    const ui = toUiTransaction('o1', pair)
    expect(ui.bankTo).toEqual(pair.bankTo)
    expect(ui.toDate).toBe('2026-10-14')
    expect(toUiTransaction('o1', deposit).toDate).toBeUndefined()
  })

  it('bankRestoreOf: the arrival day when it differs, the incoming key when both sides came from banks, nothing otherwise', () => {
    expect(bankRestoreOf(toUiTransaction('o1', pair))).toEqual({ toDate: '2026-10-14', bankToKey: IN_KEY })
    expect(bankRestoreOf(toUiTransaction('o1', deposit))).toEqual({})
    const expense: LedgerTransaction = { ...deposit, type: 'expense', toAccountId: undefined, toAmountMinor: undefined, toCurrency: undefined, bankTo: undefined }
    expect(bankRestoreOf(toUiTransaction('o1', expense))).toEqual({})
  })

  it('restoreTransaction of a bank transfer sends both with the draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transaction: { id: pair.id } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await restoreTransaction('o1', toUiTransaction('o1', pair))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/o1/transactions')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      clientId: pair.id, type: 'transfer', status: 'actual', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000,
      paymentDate: '2026-10-12', isRecurring: false, tags: ['q4'], fileUrls: [], toDate: '2026-10-14', bankToKey: IN_KEY,
    })
  })
})
