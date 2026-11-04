'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  analyticsFiltersToParams,
  knownAnalyticsFilters,
  parseAnalyticsFilters,
  withNormalKinds,
  type AnalyticsFilters,
  type AnalyticsScope,
  type KnownAnalyticsIds,
} from '@/lib/domain/analytics-filter/filter'
import { buildKindTree } from '@/lib/domain/analytics-filter/kinds'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'

export interface UseAnalyticsFiltersResult {
  /** The address's filters without the ids the company does not have (deleted), in their normal form: what the page applies and shows. */
  filters: AnalyticsFilters
  /** Writes the filters into the address (replace, no scroll), as the journal does with its view. */
  setFilters: (next: AnalyticsFilters) => void
}

/**
 * The report filters of S10f: they live in the address, so a link shares them and the report tabs keep them. This is the one
 * owner of the company's lists the filters are checked against: a deleted id is ignored everywhere (S10f), and a whole payment
 * group in the address is stored as its type once the categories are known. The Balance (`accounts`) reads only the accounts;
 * the operations' counterparties and tags are read only for the other reports.
 */
export function useAnalyticsFilters(scope: AnalyticsScope): UseAnalyticsFiltersResult {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams().toString()
  const { orgId, accounts, accountsLoading, incomeCategories, expenseCategories, categoriesLoading } = useShell()
  const operations = scope === 'operations'
  const { counterparties, loading: counterpartiesLoading } = useCounterparties(operations ? orgId : null)
  const { tags, loading: tagsLoading } = useTags(operations ? orgId : null)
  // Parsed once per address, so the pages' memos see the same object until the address changes.
  const parsed = useMemo(() => parseAnalyticsFilters(new URLSearchParams(query)), [query])
  const known = useMemo<KnownAnalyticsIds>(
    () => ({
      accountIds: accountsLoading ? undefined : new Set(accounts.map((a) => a.id)),
      categoryIds: categoriesLoading ? undefined : new Set([...incomeCategories, ...expenseCategories].map((c) => c.id)),
      counterpartyIds: operations && !counterpartiesLoading ? new Set(counterparties.map((c) => c.id)) : undefined,
      tagIds: operations && !tagsLoading ? new Set(tags.map((t) => t.id)) : undefined,
    }),
    [operations, accounts, accountsLoading, incomeCategories, expenseCategories, categoriesLoading, counterparties, counterpartiesLoading, tags, tagsLoading]
  )
  const tree = useMemo(() => buildKindTree([...incomeCategories, ...expenseCategories]), [incomeCategories, expenseCategories])
  const filters = useMemo(() => {
    const pruned = knownAnalyticsFilters(parsed, known)
    // The payment groups need the whole list of categories: until it is loaded the choice stays as it is in the address.
    return categoriesLoading ? pruned : withNormalKinds(pruned, tree)
  }, [parsed, known, categoriesLoading, tree])
  const setFilters = (next: AnalyticsFilters) => {
    const params = analyticsFiltersToParams(next).toString()
    router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false })
  }
  return { filters, setFilters }
}
