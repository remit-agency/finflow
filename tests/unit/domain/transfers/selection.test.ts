import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { convertSourceOf, mergePairOf } from '@/lib/domain/transfers/selection'

let n = 0
function bankOp(type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<LedgerTransaction> = {}): LedgerTransaction {
  n++
  return {
    id: `bk_${String(n).padStart(32, '0')}`, type, status: 'actual', accountId, amountMinor, currency: 'PLN', paymentDate,
    accrual: { mode: 'date', date: paymentDate }, isRecurring: false, tags: [], fileUrls: [], bank: { accountRef: `ba-${accountId}` }, ...extra,
  }
}

describe('convertSourceOf', () => {
  it('is the account when every selected row is a bank operation of that one account, either side', () => {
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('income', 'mil', 2, '2026-10-21')])).toEqual({ accountId: 'mil', currency: 'PLN' })
  })

  it('is null for nothing, two accounts or a row that is not a bank side', () => {
    expect(convertSourceOf([])).toBeNull()
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('expense', 'mono', 1, '2026-10-20')])).toBeNull()
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('expense', 'mil', 1, '2026-10-20', { bank: undefined })])).toBeNull()
  })
})

describe('mergePairOf', () => {
  it('is the expense and the income in that order, whatever order they were selected in', () => {
    const out = bankOp('expense', 'mil', 100, '2026-10-20')
    const inc = bankOp('income', 'mono', 100, '2026-10-22')
    expect(mergePairOf([inc, out])).toEqual([out, inc])
    expect(mergePairOf([out, inc])).toEqual([out, inc])
  })

  it('is null for anything the ledger would refuse', () => {
    const out = bankOp('expense', 'mil', 100, '2026-10-20')
    expect(mergePairOf([out])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mil', 100, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 99, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 100, '2026-10-28')])).toBeNull()
    expect(mergePairOf([out, bankOp('expense', 'mono', 100, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 100, '2026-10-20'), bankOp('income', 'cash', 100, '2026-10-20')])).toBeNull()
  })
})
