import { isDay } from '@/lib/domain/ledger/days'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { ReportError } from '@/lib/domain/reports/errors'

function bad(field: string): never {
  throw new ReportError('invalid_input', { field })
}

function single(p: URLSearchParams, key: string): string {
  const values = p.getAll(key)
  if (values.length !== 1) bad(key)
  return values[0]
}

function wholeNumber(text: string, key: string, min: number, max: number): number {
  if (!/^\d{1,4}$/.test(text)) bad(key)
  const n = Number(text)
  if (n < min || n > max) bad(key)
  return n
}

/** `GET /calendar?year=2026&month=11` (month 1-12). */
export function parseCalendarQuery(p: URLSearchParams): { year: number; month: number } {
  for (const key of p.keys()) if (key !== 'year' && key !== 'month') bad(key)
  return { year: wholeNumber(single(p, 'year'), 'year', 2000, 2100), month: wholeNumber(single(p, 'month'), 'month', 1, 12) }
}

/** `GET /calendar/day?date=YYYY-MM-DD`. */
export function parseDayQuery(p: URLSearchParams): string {
  for (const key of p.keys()) if (key !== 'date') bad(key)
  const date = single(p, 'date')
  if (!isDay(date)) bad('date')
  return date
}

/** The stored company minimum: a whole number of minor units from 0 to MAX_MINOR; anything else (absent included) is 0. */
export function parseCashMinimum(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_MINOR ? value : 0
}
