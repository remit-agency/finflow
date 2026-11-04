'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { analyticsFiltersToParams, parseAnalyticsFilters, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'

export interface UseAnalyticsFiltersResult {
  filters: AnalyticsFilters
  /** Writes the filters into the address (replace, no scroll), as the journal does with its view. */
  setFilters: (next: AnalyticsFilters) => void
}

/** The report filters of S10f: they live in the address, so a link shares them and the report tabs keep them. */
export function useAnalyticsFilters(): UseAnalyticsFiltersResult {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams().toString()
  // Parsed once per address, so the pages' memos see the same object until the address changes.
  const filters = useMemo(() => parseAnalyticsFilters(new URLSearchParams(query)), [query])
  const setFilters = (next: AnalyticsFilters) => {
    const params = analyticsFiltersToParams(next).toString()
    router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false })
  }
  return { filters, setFilters }
}
