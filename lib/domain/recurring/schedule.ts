// The schedule of a series (S11): pure functions on `YYYY-MM-DD` days (UTC calendar days, never moments), so the summer
// time change never moves a day. Weekends and Polish holidays come from lib/utils/pl-calendar.ts.
import { addDays, daysApart, fromDay, toDay } from '@/lib/domain/ledger/days'
import { isBusinessDay, nextBusinessDay, previousBusinessDay } from '@/lib/utils/pl-calendar'
import { MAX_INTERVAL, WINDOW_MONTHS, type Schedule, type WeekendRule } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Days in month `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Months counted from year 0: `year * 12 + month - 1`. */
function monthIndex(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1
}

/** Day `dayOfMonth` of the month `index`, or that month's last day when it is shorter. */
function dayOfMonthIndex(index: number, dayOfMonth: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${pad(month)}-${pad(Math.min(dayOfMonth, daysInMonth(year, month)))}`
}

/** `day` plus `n` months; a day the target month does not have becomes its last day (2026-11-30 + 3 = 2027-02-28). */
export function addMonthsClamped(day: string, n: number): string {
  return dayOfMonthIndex(monthIndex(day) + n, Number(day.slice(8, 10)))
}

/** The last day the planned operations reach on `today`: three months ahead, included. */
export function windowEnd(today: string): string {
  return addMonthsClamped(today, WINDOW_MONTHS)
}

/** ISO weekday: 1 Monday ... 7 Sunday. */
export function isoWeekday(day: string): number {
  const w = fromDay(day).getUTCDay()
  return w === 0 ? 7 : w
}

/** The payment day of an occurrence: the occurrence itself, or the next / previous Polish business day when it is not one. */
export function paymentDayOf(occurrence: string, rule: WeekendRule): string {
  if (rule === 'none') return occurrence
  const date = fromDay(occurrence)
  if (isBusinessDay(date)) return occurrence
  return toDay(rule === 'next' ? nextBusinessDay(date) : previousBusinessDay(date))
}

/**
 * The occurrences (nominal days, before `weekendRule`) of a schedule within [from, to], both included, ascending. The first
 * occurrence is the first rule day on or after `startDate`; none falls after `endDate`. A month without `dayOfMonth` takes
 * its last day. everyNMonths and yearly keep the phase of the month of `startDate`.
 */
export function occurrencesBetween(s: Schedule, from: string, to: string): string[] {
  const lo = from > s.startDate ? from : s.startDate
  const hi = s.endDate !== undefined && s.endDate < to ? s.endDate : to
  if (lo > hi) return []
  const out: string[] = []
  if (s.frequency === 'weekly') {
    let day = addDays(s.startDate, ((s.weekday ?? 1) - isoWeekday(s.startDate) + 7) % 7)
    if (day < lo) day = addDays(day, Math.ceil(daysApart(day, lo) / 7) * 7)
    for (; day <= hi; day = addDays(day, 7)) out.push(day)
    return out
  }
  const step = s.frequency === 'monthly' ? 1 : s.frequency === 'yearly' ? 12 : s.interval
  const dom = s.dayOfMonth ?? 1
  const start = monthIndex(s.startDate)
  for (let k = Math.floor((monthIndex(lo) - start) / step); ; k++) {
    const day = dayOfMonthIndex(start + k * step, dom)
    if (day > hi) break
    if (day >= lo) out.push(day)
  }
  return out
}

/** The first occurrence strictly after `day`, or null when there is none within the longest period (the series ended). */
export function nextOccurrenceAfter(s: Schedule, day: string): string | null {
  return occurrencesBetween(s, addDays(day, 1), addMonthsClamped(day, MAX_INTERVAL + 1))[0] ?? null
}

/**
 * The period an occurrence of the schedule pays for: its week (the Monday), its month, its block of N months (counted from
 * the month of `startDate`) or its year. Two occurrences of one period pay for the same thing (S11: a change of the series
 * never plans a period that is already paid, skipped or deleted).
 */
export function periodOf(s: Schedule, day: string): string {
  switch (s.frequency) {
    case 'weekly':
      return addDays(day, 1 - isoWeekday(day))
    case 'monthly':
      return day.slice(0, 7)
    case 'yearly':
      return day.slice(0, 4)
    case 'everyNMonths':
      return String(Math.floor((monthIndex(day) - monthIndex(s.startDate)) / s.interval))
  }
}

/** The first day of the period `day` is in (see `periodOf`). */
export function periodStart(s: Schedule, day: string): string {
  switch (s.frequency) {
    case 'weekly':
      return addDays(day, 1 - isoWeekday(day))
    case 'monthly':
      return `${day.slice(0, 7)}-01`
    case 'yearly':
      return `${day.slice(0, 4)}-01-01`
    case 'everyNMonths': {
      const start = monthIndex(s.startDate)
      return dayOfMonthIndex(start + Math.floor((monthIndex(day) - start) / s.interval) * s.interval, 1)
    }
  }
}
