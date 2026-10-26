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
