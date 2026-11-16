import type { CalendarMonth, DayPayments, Forecast } from '@/lib/domain/forecast/types'
import { readApiError } from './ledger-client'

const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

export const fetchForecast = (orgId: string, signal?: AbortSignal) => read<Forecast>(`${org(orgId)}/forecast`, signal)
export const fetchCalendarMonth = (orgId: string, year: number, month: number, signal?: AbortSignal) =>
  read<CalendarMonth>(`${org(orgId)}/calendar?year=${year}&month=${month}`, signal)
export const fetchCalendarDay = (orgId: string, date: string, signal?: AbortSignal) =>
  read<DayPayments>(`${org(orgId)}/calendar/day?date=${encodeURIComponent(date)}`, signal)
