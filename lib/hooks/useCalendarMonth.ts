'use client'
import { fetchCalendarMonth } from '@/lib/api/forecast-client'
import type { CalendarMonth } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/** One calendar month (S13). While another month is read, `busy` is true and `data` is the previous answer. */
export function useCalendarMonth(orgId: string, year: number, month: number): { data: CalendarMonth | null; busy: boolean; error: boolean } {
  const { data, last, error } = useRecurringRead(orgId, `month:${year}-${month}`, (signal) => fetchCalendarMonth(orgId, year, month, signal))
  return { data: data ?? last, busy: data === null, error }
}
