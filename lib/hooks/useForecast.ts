'use client'
import { fetchForecast } from '@/lib/api/forecast-client'
import type { Forecast } from '@/lib/domain/forecast/types'
import { useRecurringRead } from './useRecurringRead'

/** The 90-day forecast and cash gap (S13), read again after any change in this browser. */
export function useForecast(orgId: string): { forecast: Forecast | null; error: boolean } {
  const { data, last, error } = useRecurringRead(orgId, 'forecast', (signal) => fetchForecast(orgId, signal))
  return { forecast: data ?? last, error }
}
