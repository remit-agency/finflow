'use client'
import { fetchCalendarDay } from '@/lib/api/forecast-client'
import type { DayPayments } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/**
 * The payments of one calendar day (S13), read again after any change (a plan paid or moved). A null `date` (no day
 * selected) reads nothing: `data` and `error` stay empty.
 */
export function useCalendarDay(orgId: string, date: string | null): { data: DayPayments | null; error: boolean } {
  // The fetcher runs only for a day, so the empty fallback is never sent.
  const { data, error } = useRecurringRead(orgId, date === null ? null : `day:${date}`, (signal) => fetchCalendarDay(orgId, date ?? '', signal))
  return { data, error }
}
