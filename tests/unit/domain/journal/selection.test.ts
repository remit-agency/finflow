// tests/unit/domain/journal/selection.test.ts
import { describe, expect, it } from 'vitest'
import { categoryTypeOf, patchTouches, selectionSummary, splitByPatch } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (id: string, over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id,
  type: 'expense',
  status: 'actual',
  accountId: 'a1',
  amountMinor: 1000,
  currency: 'PLN',
  paymentDate: '2026-10-10',
  accrual: { mode: 'date', date: '2026-10-10' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

describe('categoryTypeOf', () => {
  it('is the common type of income/expense rows and null otherwise', () => {
    expect(categoryTypeOf([tx('a'), tx('b')])).toBe('expense')
    expect(categoryTypeOf([tx('a'), tx('b', { type: 'income' })])).toBeNull()
    expect(categoryTypeOf([tx('a', { type: 'transfer' })])).toBeNull()
    expect(categoryTypeOf([tx('a'), tx('b', { type: 'transfer' })])).toBe('expense')
    expect(categoryTypeOf([])).toBeNull()
  })
})

describe('patchTouches', () => {
  it('knows which fields a transfer cannot take', () => {
    expect(patchTouches({ categoryId: 'k' }, 'transfer')).toBe(true)
    expect(patchTouches({ counterpartyId: null }, 'transfer')).toBe(true)
    expect(patchTouches({ accrual: { mode: 'date', date: '2026-10-01' } }, 'transfer')).toBe(true)
    expect(patchTouches({ description: 'x', paymentDate: '2026-10-01' }, 'transfer')).toBe(false)
  })
})

describe('splitByPatch', () => {
  const today = '2026-10-27'
  it('skips transfers for category, counterparty and accrual', () => {
    const { apply, skipped } = splitByPatch([tx('a'), tx('t', { type: 'transfer' })], { categoryId: 'k' }, today)
    expect(apply.map((t) => t.id)).toEqual(['a'])
    expect(skipped).toEqual([{ id: 't', reason: 'transfer' }])
  })
  it('skips actual operations that would move into the future', () => {
    const { apply, skipped } = splitByPatch([tx('a'), tx('p', { status: 'planned' })], { paymentDate: '2026-11-01' }, today)
    expect(apply.map((t) => t.id)).toEqual(['p'])
    expect(skipped).toEqual([{ id: 'a', reason: 'future_actual' }])
  })
  it('clearing a field applies to everything that has the field', () => {
    const { apply } = splitByPatch([tx('a'), tx('b')], { description: null }, today)
    expect(apply).toHaveLength(2)
  })
})

describe('selectionSummary', () => {
  it('counts rows and adds the company-currency amounts of income (+) and expenses (-); transfers and planned rows add nothing', () => {
    const rows = [
      tx('a', { amountMinor: 1000 }),
      tx('b', { type: 'income', amountMinor: 3000 }),
      tx('c', { type: 'transfer', toAccountId: 'a2', toAmountMinor: 500, toCurrency: 'PLN' }),
      tx('d', { status: 'planned', amountMinor: 999 }),
    ]
    expect(selectionSummary(rows, 'PLN')).toEqual({ count: 4, totalBaseMinor: 2000 })
  })
})
