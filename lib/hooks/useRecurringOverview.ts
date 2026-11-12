'use client'

import { fetchRecurringOverview } from '@/lib/api/recurring-client'
import type { RecurringOverview } from '@/lib/domain/recurring/types'
import { useRecurringRead } from './useRecurringRead'

export interface UseRecurringOverview {
  overview: RecurringOverview | null
  /** The last read failed (the last good answer, if any, stays). */
  error: boolean
  refresh: () => void
}

/** The page «Планові платежі» (S11): read on open, on `refresh` and after any change in this browser (a plan, a series, a match). */
export function useRecurringOverview(orgId: string): UseRecurringOverview {
  const { data, error, refresh } = useRecurringRead(orgId, 'overview', (signal) => fetchRecurringOverview(orgId, signal))
  return { overview: data, error, refresh }
}
