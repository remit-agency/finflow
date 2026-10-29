const WARSAW_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const WARSAW_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw',
  hour: '2-digit',
  hourCycle: 'h23',
})

/**
 * "Today" for the app: the calendar date in Warsaw at this moment, as a Date at 00:00 UTC (the
 * app's calendar-day convention, see lib/utils/date.ts). Near midnight UTC and Warsaw disagree
 * about the date; users in Poland expect Warsaw's. Stored dates stay UTC days. The parts are picked
 * by type, so the result does not depend on how any locale orders or separates them.
 */
export function todayUtcDay(now: Date = new Date()): Date {
  const parts = WARSAW_DAY.formatToParts(now)
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value)
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')))
}

/** `todayUtcDay` as the `YYYY-MM-DD` string the ledger API and the forms use. */
export function todayDay(now: Date = new Date()): string {
  return todayUtcDay(now).toISOString().slice(0, 10)
}

/** The hour (0-23) on a Warsaw clock at this moment; follows the summer/winter time change. */
export function warsawHour(now: Date = new Date()): number {
  return Number(WARSAW_HOUR.formatToParts(now).find((p) => p.type === 'hour')?.value)
}
