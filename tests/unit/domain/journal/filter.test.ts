// tests/unit/domain/journal/filter.test.ts
import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  filtersToParams,
  hasActiveFilters,
  matchesFilters,
  NO_TAG,
  normalizeText,
  parseFilters,
  type FilterContext,
} from '@/lib/domain/journal/filter'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const tx = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 't1',
  type: 'expense',
  status: 'actual',
  accountId: 'a1',
  amountMinor: 12_000,
  currency: 'PLN',
  paymentDate: '2026-10-10',
  accrual: { mode: 'date', date: '2026-10-10' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

const ctx: FilterContext = {
  accountName: (id) => ({ a1: 'Konto Główne', a2: 'Kasa' })[id],
  counterpartyName: (id) => ({ c1: 'Łódzka Energetyka' })[id],
}

describe('normalizeText', () => {
  it('lowers case and drops diacritics, including ł', () => {
    expect(normalizeText('Łódź ŻÓŁĆ')).toBe('lodz zolc')
  })
})

describe('query string', () => {
  it('round-trips every field', () => {
    const f = {
      ...EMPTY_FILTERS,
      from: '2026-10-01',
      to: '2026-10-31',
      basis: 'accrual' as const,
      q: 'energia',
      minMinor: 100,
      maxMinor: 50_000,
      counterpartyIds: ['c1', 'c2'],
      types: ['income' as const, 'expense' as const],
      status: 'planned' as const,
      accountId: 'a1',
      categoryIds: ['k1'],
    }
    expect(parseFilters(filtersToParams(f))).toEqual(f)
  })
  it('an empty filter set serialises to nothing', () => {
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('')
  })
  it('drops what is invalid instead of failing', () => {
    const p = new URLSearchParams('from=oops&to=2026-02-30&basis=x&min=-5&max=1.5&types=income,bogus&status=maybe&account=a/b&cp=c1,,c 2')
    expect(parseFilters(p)).toEqual({ ...EMPTY_FILTERS, types: ['income'], counterpartyIds: ['c1'] })
  })
  it('caps a list at 30 ids', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`).join(',')
    expect(parseFilters(new URLSearchParams({ cp: many })).counterpartyIds).toHaveLength(30)
  })
})

describe('hasActiveFilters', () => {
  it('ignores the date basis alone', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, basis: 'accrual' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'x' })).toBe(true)
  })
})

describe('matchesFilters', () => {
  it('passes everything with no filters', () => {
    expect(matchesFilters(tx(), EMPTY_FILTERS, ctx)).toBe(true)
  })
  it('type and status', () => {
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, types: ['income'] }, ctx)).toBe(false)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, types: ['income', 'expense'] }, ctx)).toBe(true)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, status: 'planned' }, ctx)).toBe(false)
  })
  it('amount range is inclusive and in the minor units of the row', () => {
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, minMinor: 12_000, maxMinor: 12_000 }, ctx)).toBe(true)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, minMinor: 12_001 }, ctx)).toBe(false)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, maxMinor: 11_999 }, ctx)).toBe(false)
  })
  it('categories and counterparties', () => {
    expect(matchesFilters(tx({ categoryId: 'k1' }), { ...EMPTY_FILTERS, categoryIds: ['k1', 'k2'] }, ctx)).toBe(true)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, categoryIds: ['k1'] }, ctx)).toBe(false)
    expect(matchesFilters(tx({ counterpartyId: 'c1' }), { ...EMPTY_FILTERS, counterpartyIds: ['c1'] }, ctx)).toBe(true)
    expect(matchesFilters(tx(), { ...EMPTY_FILTERS, counterpartyIds: ['c1'] }, ctx)).toBe(false)
  })
  it('account matches the source and the target of a transfer', () => {
    const t = tx({ type: 'transfer', toAccountId: 'a2', toAmountMinor: 12_000, toCurrency: 'PLN' })
    expect(matchesFilters(t, { ...EMPTY_FILTERS, accountId: 'a2' }, ctx)).toBe(true)
    expect(matchesFilters(t, { ...EMPTY_FILTERS, accountId: 'a3' }, ctx)).toBe(false)
  })
  it('payment-date range', () => {
    const f = { ...EMPTY_FILTERS, from: '2026-10-10', to: '2026-10-10' }
    expect(matchesFilters(tx(), f, ctx)).toBe(true)
    expect(matchesFilters(tx({ paymentDate: '2026-10-11' }), f, ctx)).toBe(false)
  })
  it('accrual range: a period passes when it overlaps', () => {
    const f = { ...EMPTY_FILTERS, basis: 'accrual' as const, from: '2026-12-01', to: '2026-12-31' }
    const period = tx({ accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-05' } })
    expect(matchesFilters(period, f, ctx)).toBe(true)
    expect(matchesFilters(tx({ accrual: { mode: 'period', from: '2026-10-01', to: '2026-11-30' } }), f, ctx)).toBe(false)
    // The payment date alone does not decide on the accrual basis.
    expect(matchesFilters(tx({ paymentDate: '2026-12-10' }), f, ctx)).toBe(false)
  })
  it('search looks in account, counterparty and comment, ignoring case and diacritics; every word must match', () => {
    const t = tx({ counterpartyId: 'c1', description: 'Faktura za prąd' })
    const search = (q: string) => matchesFilters(t, { ...EMPTY_FILTERS, q }, ctx)
    expect(search('lodzka')).toBe(true)
    expect(search('GŁÓWNE')).toBe(true)
    expect(search('prad faktura')).toBe(true)
    expect(search('prad kasa')).toBe(false)
  })
})

describe('tags (S10t)', () => {
  it('tg and ex live in the address and count as filters', () => {
    const f = { ...EMPTY_FILTERS, tagIds: ['vat', NO_TAG], excludedOnly: true }
    expect(filtersToParams(f).toString()).toBe('tg=vat%2C_none&ex=1')
    expect(parseFilters(filtersToParams(f))).toEqual(f)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, tagIds: ['vat'] })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, excludedOnly: true })).toBe(true)
  })

  it('drops a bad tag id; ex is on only for 1', () => {
    expect(parseFilters(new URLSearchParams('tg=a/b,,vat&ex=yes'))).toEqual({ ...EMPTY_FILTERS, tagIds: ['vat'] })
  })

  it('any of the chosen tags matches; _none matches an operation without tags', () => {
    const f = (tagIds: string[]) => ({ ...EMPTY_FILTERS, tagIds })
    expect(matchesFilters(tx({ tags: ['q4', 'vat'] }), f(['vat']), ctx)).toBe(true)
    expect(matchesFilters(tx({ tags: ['q4'] }), f(['vat']), ctx)).toBe(false)
    expect(matchesFilters(tx(), f(['vat']), ctx)).toBe(false)
    expect(matchesFilters(tx(), f([NO_TAG]), ctx)).toBe(true)
    expect(matchesFilters(tx({ tags: ['q4'] }), f([NO_TAG]), ctx)).toBe(false)
    expect(matchesFilters(tx({ tags: ['q4'] }), f([NO_TAG, 'q4']), ctx)).toBe(true)
  })

  it('ex keeps only the operations excluded from analytics', () => {
    const f = { ...EMPTY_FILTERS, excludedOnly: true }
    expect(matchesFilters(tx({ tags: ['vat'], excluded: true }), f, ctx)).toBe(true)
    expect(matchesFilters(tx({ tags: ['q4'] }), f, ctx)).toBe(false)
  })
})
