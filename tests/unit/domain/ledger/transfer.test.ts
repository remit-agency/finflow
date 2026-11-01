import { describe, expect, it } from 'vitest'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const K = (c: string) => c.repeat(32)

/** A bank operation as the import writes it; `extra` replaces fields. */
function bankOp(key: string, type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: `bk_${key}`, type, status: 'actual', accountId, amountMinor, currency: 'PLN', paymentDate,
    accrual: { mode: 'date', date: paymentDate }, isRecurring: false, tags: [], fileUrls: [],
    bank: { accountRef: `ba-${accountId}`, remittance: `Przelew ${key.slice(0, 4)}` }, ...extra,
  }
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('bankKeyOf and bankSideOf', () => {
  it('a bank expense is the money that left, a bank income the money that arrived', () => {
    expect(bankKeyOf(`bk_${K('1')}`)).toBe(K('1'))
    expect(bankSideOf(bankOp(K('1'), 'expense', 'mil', 100, '2026-10-20'))).toBe('out')
    expect(bankSideOf(bankOp(K('2'), 'income', 'mil', 100, '2026-10-20'))).toBe('in')
  })

  it('a manual, planned or recurring operation, a transfer and an id without the bank prefix are no bank side', () => {
    const op = bankOp(K('1'), 'expense', 'mil', 100, '2026-10-20')
    expect(bankKeyOf('manual-12345678')).toBeNull()
    expect(bankKeyOf('bk_')).toBeNull()
    expect(bankSideOf({ ...op, bank: undefined })).toBeNull()
    expect(bankSideOf({ ...op, status: 'planned' })).toBeNull()
    expect(bankSideOf({ ...op, isRecurring: true })).toBeNull()
    expect(bankSideOf({ ...op, type: 'transfer' })).toBeNull()
    expect(bankSideOf({ ...op, id: 'manual-12345678' })).toBeNull()
  })
})

describe('convertToTransfer', () => {
  it('a bank expense becomes a transfer to the target with its bank block; category, counterparty, accrual, rules trace and flag go', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20', {
      categoryId: 'k-ex', counterpartyId: 'cp1', autoRules: [{ id: 'r1', name: 'ATM' }], description: 'Bankomat', tags: ['q4'],
      accrual: { mode: 'date', date: '2026-10-01' }, excluded: true, projectId: 'p1',
    })
    expect(convertToTransfer(atm, { id: 'cash', currency: 'PLN' })).toEqual({
      id: atm.id, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      toAccountId: 'cash', toAmountMinor: 100_000, toCurrency: 'PLN', paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: ['q4'], fileUrls: [], description: 'Bankomat',
      projectId: 'p1', bank: atm.bank,
    })
  })

  it('a bank income becomes a transfer from the target; its bank block becomes the incoming side', () => {
    const deposit = bankOp(K('2'), 'income', 'mil', 30_000, '2026-10-21')
    expect(convertToTransfer(deposit, { id: 'cash', currency: 'PLN' })).toEqual({
      id: deposit.id, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
      toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN', paymentDate: '2026-10-21',
      accrual: { mode: 'date', date: '2026-10-21' }, isRecurring: false, tags: [], fileUrls: [],
      bankTo: { key: K('2'), accountRef: 'ba-mil', remittance: 'Przelew 2222' },
    })
  })

  it('refuses another currency, the same account and anything that is not a bank side', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    expect(code(() => convertToTransfer(atm, { id: 'eur', currency: 'EUR' }))).toBe('currency_mismatch:toAccountId')
    expect(code(() => convertToTransfer(atm, { id: 'mil', currency: 'PLN' }))).toBe('invalid_input:toAccountId')
    expect(code(() => convertToTransfer({ ...atm, bank: undefined }, { id: 'cash', currency: 'PLN' }))).toBe('not_eligible:undefined')
    const transfer = convertToTransfer(atm, { id: 'cash', currency: 'PLN' })
    expect(code(() => convertToTransfer(transfer, { id: 'cash2', currency: 'PLN' }))).toBe('not_eligible:undefined')
  })
})

describe('mergeToTransfer', () => {
  it('the expense keeps its id and day; the income gives the target, its amount, its bank block and its day', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-12', { categoryId: 'k-ex', tags: ['a'] })
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14', { categoryId: 'k-in', tags: ['b'], description: 'Wpływ', fileUrls: ['f1'] })
    const { transfer, droppedTags } = mergeToTransfer(out, inc)
    expect(transfer).toEqual({
      id: out.id, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14', paymentDate: '2026-10-12',
      accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['a', 'b'], fileUrls: ['f1'],
      description: 'Wpływ', bank: out.bank, bankTo: { key: K('4'), ...inc.bank },
    })
    expect(droppedTags).toEqual([])
    expect(mergeToTransfer(out, { ...inc, paymentDate: '2026-10-12' }).transfer.toDate).toBeUndefined()
  })

  it('across currencies both real amounts stay', () => {
    const out = bankOp(K('3'), 'expense', 'eur', 10_000, '2026-10-12', { currency: 'EUR' })
    const inc = bankOp(K('4'), 'income', 'mil', 44_000, '2026-10-13')
    expect(mergeToTransfer(out, inc).transfer).toMatchObject({ amountMinor: 10_000, currency: 'EUR', toAmountMinor: 44_000, toCurrency: 'PLN' })
  })

  it('keeps the expense tags first and reports what did not fit in 10', () => {
    const t = (n: number) => `t${String(n).padStart(2, '0')}`
    const out = bankOp(K('3'), 'expense', 'mil', 100, '2026-10-12', { tags: [1, 2, 3, 4, 5, 6].map(t) })
    const inc = bankOp(K('4'), 'income', 'mono', 100, '2026-10-12', { tags: [5, 6, 7, 8, 9, 10, 11, 12].map(t) })
    const { transfer, droppedTags } = mergeToTransfer(out, inc)
    expect(transfer.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t))
    expect(droppedTags).toEqual([t(11), t(12)])
  })

  it.each([
    ['two expenses', bankOp(K('4'), 'expense', 'mono', 100, '2026-10-12')],
    ['the same account', bankOp(K('4'), 'income', 'mil', 100, '2026-10-12')],
    ['8 days apart', bankOp(K('4'), 'income', 'mono', 100, '2026-10-20')],
    ['another amount in the same currency', bankOp(K('4'), 'income', 'mono', 99, '2026-10-12')],
    ['a manual income', { ...bankOp(K('4'), 'income', 'mono', 100, '2026-10-12'), bank: undefined }],
  ])('refuses %s', (_name, inc) => {
    const out = bankOp(K('3'), 'expense', 'mil', 100, '2026-10-12')
    expect(code(() => mergeToTransfer(out, inc))).toBe('not_eligible:undefined')
  })
})

describe('splitTransferSides', () => {
  it('a transfer from bank to bank gives back the expense and the income under its own id, on the arrival day', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-12', { categoryId: 'k-ex' })
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14')
    const { transfer } = mergeToTransfer(out, { ...inc, tags: ['vat'] })
    const { kept, recreated } = splitTransferSides({ ...transfer, description: 'Własny' })
    expect(kept).toEqual({
      id: out.id, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['vat'], fileUrls: [],
      description: 'Własny', bank: out.bank,
    })
    expect(recreated).toEqual({
      id: inc.id, type: 'income', status: 'actual', accountId: 'mono', amountMinor: 100_000, currency: 'PLN',
      paymentDate: '2026-10-14', accrual: { mode: 'date', date: '2026-10-14' }, isRecurring: false, tags: ['vat'], fileUrls: [],
      description: 'Przelew 4444', bank: inc.bank,
    })
  })

  it('a converted expense comes back alone; a deposit comes back as its income under its id', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    expect(splitTransferSides(convertToTransfer(atm, { id: 'cash', currency: 'PLN' }))).toEqual({ kept: atm, recreated: null })
    const deposit = bankOp(K('2'), 'income', 'mil', 30_000, '2026-10-21')
    expect(splitTransferSides(convertToTransfer(deposit, { id: 'cash', currency: 'PLN' }))).toEqual({ kept: deposit, recreated: null })
  })

  it('refuses a manual transfer, a planned one and anything that is not a transfer', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    const transfer = convertToTransfer(atm, { id: 'cash', currency: 'PLN' })
    expect(code(() => splitTransferSides({ ...transfer, bank: undefined }))).toBe('not_eligible:undefined')
    expect(code(() => splitTransferSides({ ...transfer, status: 'planned' }))).toBe('not_eligible:undefined')
    expect(code(() => splitTransferSides(atm))).toBe('not_eligible:undefined')
  })
})

describe('combineChanges', () => {
  it('a merge written as one change moves no balance; its rollups are the sum of both changes', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-14')
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14')
    const { transfer } = mergeToTransfer(out, inc)
    const combined = combineChanges(changeSet(out, transfer, 'PLN'), changeSet(inc, null, 'PLN'))
    expect(combined.balanceDeltas).toEqual({})
    expect(combined.rollupDeltas.get('cash_mono_2026-10-14')).toEqual({ transferInMinor: 100_000, inMinor: -100_000, inBase: -100_000 })
    expect(combined.rollupDeltas.get('cash_mil_2026-10-14')).toEqual({ transferOutMinor: 100_000, outMinor: -100_000, outBase: -100_000 })
    expect(combined.rollupDeltas.get('pl_2026-10')).toEqual({ 'categories._none.expenseBase': -100_000, 'categories._none.incomeBase': -100_000 })
  })
})
