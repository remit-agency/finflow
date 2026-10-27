const DAY = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar day written as YYYY-MM-DD. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "2026-10-26" -> "2026-10" */
export function monthOf(day: string): string {
  return day.slice(0, 7)
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
}

export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number)
  return { first: `${month}-01`, last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_MS = 24 * 60 * 60 * 1000

/** True for YYYY-MM with a real month. */
export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && MONTH.test(s)
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

/** Negative, zero or positive like a comparator; day strings sort lexicographically. */
export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Months from the month of `from` to the month of `to`, both included, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  const last = monthOf(to)
  for (let m = monthOf(from); m <= last; m = nextMonth(m)) months.push(m)
  return months
}

/** Days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

/** How many days of `month` fall inside [from, to]. */
export function overlapDays(month: string, from: string, to: string): number {
  const { first, last } = monthBounds(month)
  const lo = from > first ? from : first
  const hi = to < last ? to : last
  return lo > hi ? 0 : daysInRange(lo, hi)
}

/** A Date at 00:00 UTC as a day string (the app's calendar-day convention). */
export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** A day string as a Date at 00:00 UTC. */
export function fromDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
