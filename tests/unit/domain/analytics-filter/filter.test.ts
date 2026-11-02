import { describe, expect, it } from 'vitest'
import {
  activeAnalyticsFilterCount,
  analyticsFiltersToParams,
  EMPTY_ANALYTICS_FILTERS,
  filterAccounts,
  filterForAnalytics,
  parseAnalyticsFilters,
  type AnalyticsFilters,
} from '@/lib/domain/analytics-filter/filter'
import { EMPTY_FILTERS, matchesFilters, NO_TAG, type FilterContext } from '@/lib/domain/journal/filter'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { makeAccount, makeTx } from '../../helpers/fixtures'

const f = (over: Partial<AnalyticsFilters>): AnalyticsFilters => ({ ...EMPTY_ANALYTICS_FILTERS, ...over })
const ids = (list: { id: string }[]): string[] => list.map((x) => x.id)

describe('the address', () => {
  it('round-trips every field under the journal names, the accounts in `accounts`', () => {
    const value = f({ types: ['income', 'transfer'], categoryIds: ['c1'], counterpartyIds: ['p1', 'p2'], tagIds: ['vat', NO_TAG], accountIds: ['a1', 'a2'] })
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
    const p = new URLSearchParams('types=income,bogus,income&cat=c1,,c 2,__x__&cp=a/b&tg=vat,vat&accounts=a1,a.b&period=prevYear&q=x')
    expect(parseAnalyticsFilters(p)).toEqual(f({ types: ['income'], categoryIds: ['c1'], tagIds: ['vat'], accountIds: ['a1'] }))
  })

  it('keeps at most 30 ids per list, as the journal', () => {
    const many = Array.from({ length: 40 }, (_, i) => `a${i}`).join(',')
    const parsed = parseAnalyticsFilters(new URLSearchParams({ accounts: many, tg: many }))
    expect(parsed.accountIds).toHaveLength(30)
    expect(parsed.tagIds).toHaveLength(30)
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

  it('without a choice: the same array, the excluded operations left to the reports', () => {
    const out = filterForAnalytics(all, EMPTY_ANALYTICS_FILTERS)
    expect(out.operations).toBe(all)
    expect(out).toMatchObject({ includeExcluded: false, showsExcluded: false })
  })

  it('types and categories work together', () => {
    expect(ids(filterForAnalytics(all, f({ types: ['expense'] })).operations)).toEqual(['rent', 'vat'])
    expect(ids(filterForAnalytics(all, f({ types: ['expense'], categoryIds: ['c-rent'] })).operations)).toEqual(['rent'])
    expect(ids(filterForAnalytics(all, f({ types: ['income'], categoryIds: ['c-rent'] })).operations)).toEqual([])
  })

  it('counterparties and accounts mean any of the chosen; an account matches the target of a transfer', () => {
    expect(ids(filterForAnalytics(all, f({ counterpartyIds: ['p1', 'p2'] })).operations)).toEqual(['sale', 'rent'])
    expect(ids(filterForAnalytics(all, f({ accountIds: ['a2', 'a3'] })).operations)).toEqual(['vat', 'move'])
  })

  it('a concrete tag brings the excluded operations in and says so when there are any; «без тегів» does not', () => {
    const vatOnly = filterForAnalytics(all, f({ tagIds: ['vat'] }))
    expect(ids(vatOnly.operations)).toEqual(['vat'])
    expect(vatOnly).toMatchObject({ includeExcluded: true, showsExcluded: true })
    expect(filterForAnalytics(all, f({ tagIds: ['q4'] }))).toMatchObject({ includeExcluded: true, showsExcluded: false })
    const untagged = filterForAnalytics(all, f({ tagIds: [NO_TAG] }))
    expect(ids(untagged.operations)).toEqual(['sale', 'move'])
    expect(untagged).toMatchObject({ includeExcluded: false, showsExcluded: false })
  })

  it('chooses the operations the journal lists for the same choice', () => {
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
    const choices = [
      f({ types: ['expense'], categoryIds: ['c2'] }),
      f({ counterpartyIds: ['p1'] }),
      f({ tagIds: ['vat', NO_TAG] }),
      f({ tagIds: [NO_TAG] }),
      f({ accountIds: ['a2'] }),
    ]
    for (const choice of choices) {
      const { accountIds, ...rest } = choice
      const journal = rows.filter((tx) => matchesFilters(tx, { ...EMPTY_FILTERS, ...rest, accountId: accountIds[0] }, ctx))
      expect(ids(filterForAnalytics(ui, choice).operations), JSON.stringify(choice)).toEqual(ids(journal))
    }
  })
})

describe('filterAccounts', () => {
  it('every account without a choice, otherwise the chosen ones in their order', () => {
    const accounts = [makeAccount({ id: 'a1' }), makeAccount({ id: 'a2' }), makeAccount({ id: 'a3' })]
    expect(filterAccounts(accounts, EMPTY_ANALYTICS_FILTERS)).toBe(accounts)
    expect(ids(filterAccounts(accounts, f({ accountIds: ['a3', 'a1'] })))).toEqual(['a1', 'a3'])
  })
})
