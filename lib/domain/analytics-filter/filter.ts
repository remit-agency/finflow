import { idList, matchesSelection, NO_TAG, typeList, type SelectionFacts } from '@/lib/domain/journal/filter'
import type { TxType } from '@/lib/domain/ledger/types'

/**
 * The filters of the reports (S10f): kept in the address and shared by the Cash Flow, P&L, Calendar and Balance tabs.
 * The period is chosen separately and stays out of them.
 */
export interface AnalyticsFilters {
  types: TxType[]
  categoryIds: string[]
  counterpartyIds: string[]
  /** Any of these tags; `NO_TAG` stands for «без тегів». */
  tagIds: string[]
  accountIds: string[]
}

export const EMPTY_ANALYTICS_FILTERS: AnalyticsFilters = { types: [], categoryIds: [], counterpartyIds: [], tagIds: [], accountIds: [] }

/** Which fields a report offers: the Balance is made of accounts, the other reports of operations. */
export type AnalyticsScope = 'operations' | 'accounts'

/**
 * Lenient, like the journal's `parseFilters` and with its names (`types`, `cat`, `cp`, `tg`; the accounts in `accounts`):
 * a bad value or a repeat is dropped (the journal's list readers do that), at most 30 ids a list stay, other parameters are
 * not read.
 */
export function parseAnalyticsFilters(p: Pick<URLSearchParams, 'get'>): AnalyticsFilters {
  return {
    types: typeList(p.get('types')),
    categoryIds: idList(p.get('cat')),
    counterpartyIds: idList(p.get('cp')),
    tagIds: idList(p.get('tg')),
    accountIds: idList(p.get('accounts')),
  }
}

export function analyticsFiltersToParams(f: AnalyticsFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.types.length) p.set('types', f.types.join(','))
  if (f.categoryIds.length) p.set('cat', f.categoryIds.join(','))
  if (f.counterpartyIds.length) p.set('cp', f.counterpartyIds.join(','))
  if (f.tagIds.length) p.set('tg', f.tagIds.join(','))
  if (f.accountIds.length) p.set('accounts', f.accountIds.join(','))
  return p
}

/** The fields with a choice, as the «Фільтри» button counts them: payment types and categories are one field. */
export function activeAnalyticsFilterCount(f: AnalyticsFilters, scope: AnalyticsScope): number {
  const fields: string[][] = scope === 'accounts' ? [f.accountIds] : [[...f.types, ...f.categoryIds], f.counterpartyIds, f.tagIds, f.accountIds]
  return fields.filter((list) => list.length > 0).length
}

/** The operations the reports are built from, and whether the ones excluded from analytics are among them. */
export interface AnalyticsSelection<T> {
  operations: T[]
  /** A concrete tag is chosen: the reports count the operations excluded from analytics too (Finmap's rule). */
  includeExcluded: boolean
}

/** The one rule of the reports: an operation excluded from analytics counts only when the selection includes them (S10f). */
export function countsInAnalytics(tx: { excluded?: boolean }, includeExcluded: boolean): boolean {
  return tx.excluded !== true || includeExcluded
}

/** The operations the reports are built from, by the journal's rule (`matchesSelection`); without a choice the same array. */
export function filterForAnalytics<T extends SelectionFacts & { excluded?: boolean }>(operations: T[], f: AnalyticsFilters): AnalyticsSelection<T> {
  const includeExcluded = f.tagIds.some((id) => id !== NO_TAG)
  const chosen = activeAnalyticsFilterCount(f, 'operations') === 0 ? operations : operations.filter((tx) => matchesSelection(tx, f))
  return { operations: chosen, includeExcluded }
}

/**
 * The ids of the company's lists that a field may keep. `undefined` while that list is still loading: its ids stay until it
 * is known. Archived rows are in the lists (old operations still carry them), so they count as known.
 */
export interface KnownAnalyticsIds {
  accountIds?: ReadonlySet<string>
  categoryIds?: ReadonlySet<string>
  counterpartyIds?: ReadonlySet<string>
  tagIds?: ReadonlySet<string>
}

/**
 * The filters without the ids the company does not have (a deleted account or category in an old link): the dialog, the
 * count and the reports all read the filters through this. The same object comes back when nothing is dropped.
 */
export function knownAnalyticsFilters(f: AnalyticsFilters, known: KnownAnalyticsIds): AnalyticsFilters {
  const keep = (ids: string[], set: ReadonlySet<string> | undefined, always?: string): string[] =>
    set === undefined ? ids : ids.filter((id) => id === always || set.has(id))
  const next: AnalyticsFilters = {
    types: f.types,
    categoryIds: keep(f.categoryIds, known.categoryIds),
    counterpartyIds: keep(f.counterpartyIds, known.counterpartyIds),
    tagIds: keep(f.tagIds, known.tagIds, NO_TAG),
    accountIds: keep(f.accountIds, known.accountIds),
  }
  const changed = (Object.keys(next) as (keyof AnalyticsFilters)[]).some((k) => next[k].length !== f[k].length)
  return changed ? next : f
}

/** The accounts the Balance shows: the chosen ones, or every account without a choice. */
export function filterAccounts<T extends { id: string }>(accounts: T[], f: AnalyticsFilters): T[] {
  return f.accountIds.length === 0 ? accounts : accounts.filter((a) => f.accountIds.includes(a.id))
}
