import { describe, expect, it } from 'vitest'
import {
  buildKindTree,
  categoryTypesOf,
  type KindCategory,
} from '@/lib/domain/analytics-filter/kinds'
import {
  activeAnalyticsFilterCount,
  analyticsFiltersToParams,
  countsInAnalytics,
  EMPTY_ANALYTICS_FILTERS,
  filterAccounts,
  filterForAnalytics,
  knownAnalyticsFilters,
  parseAnalyticsFilters,
  withNormalKinds,
  type AnalyticsFilters,
} from '@/lib/domain/analytics-filter/filter'
import { EMPTY_FILTERS, matchesFilters, NO_TAG, type FilterContext } from '@/lib/domain/journal/filter'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { makeAccount, makeTx } from '../../helpers/fixtures'

const f = (over: Partial<AnalyticsFilters>): AnalyticsFilters => ({ ...EMPTY_ANALYTICS_FILTERS, ...over })
const cat = (id: string, type: 'income' | 'expense', parentId?: string): KindCategory => ({ id, type, parentId })
const ids = (list: { id: string }[]): string[] => list.map((x) => x.id)

describe('the address', () => {
  it('round-trips every field under the journal names, the accounts in `accounts`', () => {
    const value = f({ types: ['income', 'transfer'], categoryIds: ['c1', '_none:expense'], counterpartyIds: ['p1', 'p2'], tagIds: ['vat', NO_TAG], accountIds: ['a1', 'a2'] })
    const params = analyticsFiltersToParams(value)
    expect([...params.keys()]).toEqual(['types', 'cat', 'cp', 'tg', 'accounts'])
    expect(params.get('tg')).toBe('vat,_none')
    expect(parseAnalyticsFilters(new URLSearchParams(params.toString()))).toEqual(value)
  })

  it('no choice is an empty query', () => {
    expect(analyticsFiltersToParams(EMPTY_ANALYTICS_FILTERS).toString()).toBe('')
    expect(parseAnalyticsFilters(new URLSearchParams(''))).toEqual(EMPTY_ANALYTICS_FILTERS)
  })

  it('drops bad values, repeats and the parameters it does not own', () => {
    const p = new URLSearchParams('types=income,bogus,income&cat=c1,,c 2,__x__,_none:bogus,_none:expense&cp=a/b&tg=vat,vat&accounts=a1,a.b&period=prevYear&q=x')
    expect(parseAnalyticsFilters(p)).toEqual(f({ types: ['income'], categoryIds: ['c1', '_none:expense'], tagIds: ['vat'], accountIds: ['a1'] }))
  })

  it('the uncategorised sentinel is read only in the category list, and only once', () => {
    expect(parseAnalyticsFilters(new URLSearchParams('cat=_none:income,_none:income')).categoryIds).toEqual(['_none:income'])
    expect(parseAnalyticsFilters(new URLSearchParams('tg=_none:income')).tagIds).toEqual([])
  })

  it('removes the repeats first, then keeps 30 ids: a repeat does not use up a place', () => {
    const repeated = [...Array.from({ length: 20 }, () => 'a0'), ...Array.from({ length: 35 }, (_, i) => `b${i}`)].join(',')
    const expected = ['a0', ...Array.from({ length: 29 }, (_, i) => `b${i}`)]
    const parsed = parseAnalyticsFilters(new URLSearchParams({ accounts: repeated, tg: repeated, cat: repeated }))
    expect(parsed.accountIds).toEqual(expected)
    expect(parsed.tagIds).toEqual(expected)
    expect(parsed.categoryIds).toEqual(expected)
    expect(parseAnalyticsFilters(new URLSearchParams({ types: 'income,income,expense' })).types).toEqual(['income', 'expense'])
  })

  it('keeps at most 30 ids per list, as the journal, the sentinels included', () => {
    const many = Array.from({ length: 40 }, (_, i) => `a${i}`).join(',')
    const parsed = parseAnalyticsFilters(new URLSearchParams({ accounts: many, tg: many, cat: `${many},_none:income` }))
    expect(parsed.accountIds).toHaveLength(30)
    expect(parsed.tagIds).toHaveLength(30)
    expect(parsed.categoryIds).toHaveLength(30)
    expect(parsed.categoryIds).not.toContain('_none:income')
  })
})

describe('activeAnalyticsFilterCount', () => {
  it('counts the fields in use; payment types and categories are one field', () => {
    expect(activeAnalyticsFilterCount(EMPTY_ANALYTICS_FILTERS, 'operations')).toBe(0)
    expect(activeAnalyticsFilterCount(f({ types: ['income'], categoryIds: ['c1', 'c2'] }), 'operations')).toBe(1)
    expect(activeAnalyticsFilterCount(f({ types: ['income'], counterpartyIds: ['p1'], tagIds: [NO_TAG], accountIds: ['a1'] }), 'operations')).toBe(4)
  })

  it('the Balance counts only the accounts', () => {
    expect(activeAnalyticsFilterCount(f({ tagIds: ['vat'] }), 'accounts')).toBe(0)
    expect(activeAnalyticsFilterCount(f({ tagIds: ['vat'], accountIds: ['a1'] }), 'accounts')).toBe(1)
  })
})

describe('filterForAnalytics', () => {
  const sale = makeTx({ id: 'sale', type: 'income', accountId: 'a1', categoryId: 'c-sales', counterpartyId: 'p1' })
  const rent = makeTx({ id: 'rent', type: 'expense', accountId: 'a1', categoryId: 'c-rent', counterpartyId: 'p2', tags: ['q4'] })
  const vat = makeTx({ id: 'vat', type: 'expense', accountId: 'a2', tags: ['vat'], excluded: true })
  const move = makeTx({ id: 'move', type: 'transfer', accountId: 'a1', toAccountId: 'a3', toAmount: 100, toCurrency: 'PLN' })
  const all = [sale, rent, vat, move]
  const known = categoryTypesOf([cat('c-sales', 'income'), cat('c-rent', 'expense')])

  it('without a choice: the same array, the excluded operations left to the reports', () => {
    const out = filterForAnalytics(all, EMPTY_ANALYTICS_FILTERS, known)
    expect(out.operations).toBe(all)
    expect(out).toMatchObject({ includeExcluded: false })
  })

  it('a payment type and a category are a union: an operation matching either one is chosen (Finmap)', () => {
    expect(ids(filterForAnalytics(all, f({ types: ['expense'] }), known).operations)).toEqual(['rent', 'vat'])
    expect(ids(filterForAnalytics(all, f({ categoryIds: ['c-rent'] }), known).operations)).toEqual(['rent'])
    expect(ids(filterForAnalytics(all, f({ types: ['income'], categoryIds: ['c-rent'] }), known).operations)).toEqual(['sale', 'rent'])
    expect(ids(filterForAnalytics(all, f({ types: ['income', 'expense'], categoryIds: ['c-rent'] }), known).operations)).toEqual(['sale', 'rent', 'vat'])
  })

  it('the uncategorised row of a type chosen: the operations of that type without a category', () => {
    const plain = makeTx({ id: 'plain', type: 'income', accountId: 'a1' })
    expect(ids(filterForAnalytics([sale, plain], f({ categoryIds: ['_none:income'] }), known).operations)).toEqual(['plain'])
  })

  it('counterparties and accounts mean any of the chosen; an account matches the target of a transfer', () => {
    expect(ids(filterForAnalytics(all, f({ counterpartyIds: ['p1', 'p2'] }), known).operations)).toEqual(['sale', 'rent'])
    expect(ids(filterForAnalytics(all, f({ accountIds: ['a2', 'a3'] }), known).operations)).toEqual(['vat', 'move'])
  })

  it('a concrete tag brings the excluded operations in and says so when there are any; «без тегів» does not', () => {
    const vatOnly = filterForAnalytics(all, f({ tagIds: ['vat'] }), known)
    expect(ids(vatOnly.operations)).toEqual(['vat'])
    expect(vatOnly).toMatchObject({ includeExcluded: true })
    expect(filterForAnalytics(all, f({ tagIds: ['q4'] }), known)).toMatchObject({ includeExcluded: true })
    const untagged = filterForAnalytics(all, f({ tagIds: [NO_TAG] }), known)
    expect(ids(untagged.operations)).toEqual(['sale', 'move'])
    expect(untagged).toMatchObject({ includeExcluded: false })
  })

  it('the shared choices (counterparties, accounts, tags) keep the journal rule for the same choice', () => {
    const ledger = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
      id: 'x',
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
    const rows = [
      ledger({ id: 'l1', type: 'income', categoryId: 'c1', counterpartyId: 'p1' }),
      ledger({ id: 'l2', categoryId: 'c2', tags: ['vat'], excluded: true }),
      ledger({ id: 'l3', accountId: 'a2', counterpartyId: 'p1', tags: ['q4'] }),
      ledger({ id: 'l4', type: 'transfer', toAccountId: 'a2', toAmountMinor: 1000, toCurrency: 'PLN' }),
      ledger({ id: 'l5', type: 'income', accountId: 'a2' }),
    ]
    const ui = rows.map((tx) => toUiTransaction('org', tx))
    const ctx: FilterContext = { accountName: () => undefined, counterpartyName: () => undefined }
    const choices = [f({ counterpartyIds: ['p1'] }), f({ tagIds: ['vat', NO_TAG] }), f({ tagIds: [NO_TAG] }), f({ accountIds: ['a2'] })]
    for (const choice of choices) {
      const { accountIds, ...rest } = choice
      const journal = rows.filter((tx) => matchesFilters(tx, { ...EMPTY_FILTERS, ...rest, accountId: accountIds[0] }, ctx))
      expect(ids(filterForAnalytics(ui, choice, known).operations), JSON.stringify(choice)).toEqual(ids(journal))
    }
  })

  it('the journal keeps AND for a type and a category; the reports take the union of the same choice (regression)', () => {
    const ledger = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
      id: 'x',
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
    const rows = [ledger({ id: 'inc', type: 'income', categoryId: 'ci' }), ledger({ id: 'exp-c1', categoryId: 'c1' }), ledger({ id: 'exp-c2', categoryId: 'c2' })]
    const ctx: FilterContext = { accountName: () => undefined, counterpartyName: () => undefined }
    const journal = rows.filter((tx) => matchesFilters(tx, { ...EMPTY_FILTERS, types: ['expense'], categoryIds: ['c1'] }, ctx))
    expect(journal.map((tx) => tx.id)).toEqual(['exp-c1'])
    const reports = filterForAnalytics(rows.map((tx) => toUiTransaction('org', tx)), f({ types: ['expense'], categoryIds: ['c1'] }), categoryTypesOf([cat('c1', 'expense'), cat('ci', 'income')]))
    expect(ids(reports.operations)).toEqual(['exp-c1', 'exp-c2'])
  })
})

describe('a deleted category counts as uncategorised, in the choice and in the normal form (S10f)', () => {
  // Income: sales (kept) and inc-c (deleted from the company); expense: rent.
  const after = [cat('inc-a', 'income'), cat('inc-b', 'income'), cat('exp-rent', 'expense')]
  const known = categoryTypesOf(after)
  const tree = buildKindTree(after)
  const op = (id: string, type: 'income' | 'expense' | 'transfer', categoryId?: string) =>
    makeTx({ id, type, accountId: 'a1', ...(categoryId === undefined ? {} : { categoryId }), ...(type === 'transfer' ? { toAccountId: 'a2', toAmount: 1, toCurrency: 'PLN' } : {}) })
  const ops = [
    op('sale', 'income', 'inc-a'),
    op('gone-in', 'income', 'inc-c'),
    op('plain-in', 'income'),
    op('rent', 'expense', 'exp-rent'),
    op('plain-out', 'expense'),
    op('move', 'transfer'),
  ]

  it('the uncategorised expenses take an operation of a deleted expense category, and «all expenses but rent» keeps it too', () => {
    const gone = op('gone-out', 'expense', 'exp-deleted')
    // Rent is the only expense category, so «all expenses but rent» is the uncategorised row alone.
    expect(ids(filterForAnalytics([...ops, gone], f({ categoryIds: ['_none:expense'] }), known).operations)).toEqual(['plain-out', 'gone-out'])
  })

  it('a link that excludes the deleted category, once it is gone, selects the same operations as its normal form (types=income)', () => {
    const link = f({ categoryIds: ['inc-a', 'inc-b', '_none:income'] })
    const normal = withNormalKinds(link, tree)
    expect(normal).toEqual(f({ types: ['income'] }))
    const expected = ['sale', 'gone-in', 'plain-in']
    expect(ids(filterForAnalytics(ops, link, known).operations)).toEqual(expected)
    expect(ids(filterForAnalytics(ops, normal, known).operations)).toEqual(expected)
  })

  it('for every choice of the company the stored form and its normal form select the same operations', () => {
    const keys = ['income', 'expense', 'transfer', 'inc-a', 'inc-b', 'inc-c', 'exp-rent', '_none:income', '_none:expense', 'inc-gone']
    const all = [...ops, op('gone-in-2', 'income', 'inc-gone'), op('legacy', 'expense', 'inc-a')]
    for (let mask = 0; mask < 2 ** keys.length; mask++) {
      const chosen = keys.filter((_, i) => (mask >> i) & 1)
      const types = chosen.filter((k): k is 'income' | 'expense' | 'transfer' => ['income', 'expense', 'transfer'].includes(k))
      const categoryIds = chosen.filter((k) => !['income', 'expense', 'transfer'].includes(k))
      const stored = f({ types, categoryIds })
      const normal = withNormalKinds(stored, tree)
      const label = JSON.stringify({ types, categoryIds })
      expect(ids(filterForAnalytics(all, normal, known).operations), label).toEqual(ids(filterForAnalytics(all, stored, known).operations))
    }
  })
})

describe('withNormalKinds (the normal form on read: the hook passes the choice through it)', () => {
  const tree = buildKindTree([cat('inc-a', 'income'), cat('inc-b', 'income'), cat('exp-rent', 'expense')])

  it('the same object comes back when the choice is already normal, so the pages keep their memos', () => {
    const value = f({ types: ['expense'], categoryIds: ['inc-a'], tagIds: [NO_TAG] })
    expect(withNormalKinds(value, tree)).toBe(value)
    const none = f({ counterpartyIds: ['p1'] })
    expect(withNormalKinds(none, tree)).toBe(none)
  })

  it('a whole group in the address is stored as its type; the other fields come back as they were', () => {
    const value = f({ categoryIds: ['inc-b', 'inc-a', '_none:income'], tagIds: ['vat'] })
    expect(withNormalKinds(value, tree)).toEqual(f({ types: ['income'], tagIds: ['vat'] }))
  })

  it('ids of a choice that is not whole come out in the tree\'s order; the normal form is then the same object on the next read', () => {
    const once = withNormalKinds(f({ categoryIds: ['exp-rent', 'inc-b'] }), tree)
    expect(once.categoryIds).toEqual(['inc-b', 'exp-rent'])
    expect(withNormalKinds(once, tree)).toBe(once)
  })

  it('a group without categories keeps its uncategorised row as an id', () => {
    const none = buildKindTree([cat('exp-rent', 'expense')])
    const value = f({ categoryIds: ['_none:income'] })
    expect(withNormalKinds(value, none)).toBe(value)
  })
})

describe('knownAnalyticsFilters', () => {
  const known = {
    accountIds: new Set(['a1', 'archived-account']),
    categoryIds: new Set(['c1', 'c1-child']),
    counterpartyIds: new Set(['p1']),
    tagIds: new Set(['vat']),
  }

  it('drops the ids the company does not have (deleted), keeps the archived ones and «без тегів»', () => {
    const value = f({ categoryIds: ['c1', 'gone'], counterpartyIds: ['gone', 'p1'], tagIds: ['gone', NO_TAG, 'vat'], accountIds: ['gone', 'archived-account'] })
    expect(knownAnalyticsFilters(value, known)).toEqual(
      f({ categoryIds: ['c1'], counterpartyIds: ['p1'], tagIds: [NO_TAG, 'vat'], accountIds: ['archived-account'] }),
    )
  })

  it('keeps the uncategorised sentinels (they are not company ids), and a subcategory the company still has', () => {
    const value = f({ categoryIds: ['c1-child', '_none:income', '_none:expense', 'deleted-child'] })
    expect(knownAnalyticsFilters(value, known)).toEqual(f({ categoryIds: ['c1-child', '_none:income', '_none:expense'] }))
  })

  it('the Balance: a deleted account is dropped, so no account is left and the field counts nothing', () => {
    const pruned = knownAnalyticsFilters(f({ accountIds: ['gone'] }), { accountIds: new Set(['a1']) })
    expect(activeAnalyticsFilterCount(pruned, 'accounts')).toBe(0)
    expect(ids(filterAccounts([makeAccount({ id: 'a1' })], pruned))).toEqual(['a1'])
  })

  it('a list that is still loading (undefined) keeps its ids; the same object comes back when nothing is dropped', () => {
    const value = f({ categoryIds: ['gone'], tagIds: [NO_TAG] })
    expect(knownAnalyticsFilters(value, { categoryIds: undefined })).toBe(value)
    const clean = f({ categoryIds: ['c1'], tagIds: [NO_TAG, 'vat'] })
    expect(knownAnalyticsFilters(clean, known)).toBe(clean)
  })
})

describe('countsInAnalytics', () => {
  it('an operation excluded from analytics counts only when the selection includes them', () => {
    expect(countsInAnalytics({}, false)).toBe(true)
    expect(countsInAnalytics({ excluded: false }, false)).toBe(true)
    expect(countsInAnalytics({ excluded: true }, false)).toBe(false)
    expect(countsInAnalytics({ excluded: true }, true)).toBe(true)
  })
})

describe('filterAccounts', () => {
  it('every account without a choice, otherwise the chosen ones in their order', () => {
    const accounts = [makeAccount({ id: 'a1' }), makeAccount({ id: 'a2' }), makeAccount({ id: 'a3' })]
    expect(filterAccounts(accounts, EMPTY_ANALYTICS_FILTERS)).toBe(accounts)
    expect(ids(filterAccounts(accounts, f({ accountIds: ['a3', 'a1'] })))).toEqual(['a1', 'a3'])
  })
})
