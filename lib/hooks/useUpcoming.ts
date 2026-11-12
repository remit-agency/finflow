'use client'

import { fetchUpcoming } from '@/lib/api/recurring-client'
import type { UpcomingPeriod, UpcomingRead } from '@/lib/domain/recurring/types'
import { useRecurringRead } from './useRecurringRead'

/**
 * The journal's «Майбутні платежі» block (S12e): the planned operations of a period, read again after any change in this
 * browser. While another period is being read, `read` is the previous answer and `busy` is true.
 */
export function useUpcoming(orgId: string, period: UpcomingPeriod): { read: UpcomingRead | null; busy: boolean } {
  const { data, last } = useRecurringRead(orgId, period, (signal) => fetchUpcoming(orgId, period, signal))
  return { read: data ?? last, busy: data === null }
}
