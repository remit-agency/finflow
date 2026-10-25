const WARSAW_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * "Today" for the app: the calendar date in Warsaw at this moment, as a Date at 00:00 UTC (the
 * app's calendar-day convention, see lib/utils/date.ts). Near midnight UTC and Warsaw disagree
 * about the date; users in Poland expect Warsaw's. Stored dates stay UTC days.
 */
export function todayUtcDay(now: Date = new Date()): Date {
  const [year, month, day] = WARSAW_DAY.format(now).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}
