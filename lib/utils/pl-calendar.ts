// Polish public holidays and business days (S03). Dates are calendar days as Date at 00:00 UTC;
// only UTC getters are used. Used by NBP rates (S04), schedules (S11) and the cash gap forecast (S13).

const DAY_MS = 24 * 60 * 60 * 1000

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day))
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)
const dayStart = (date: Date) => utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())

/** Easter Sunday (Meeus/Jones/Butcher, Gregorian). */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(year, month, day)
}

/**
 * Public holidays (dni wolne od pracy) of a year, ascending. Epiphany (6 Jan) since 2011, Christmas
 * Eve (24 Dec) since 2025. Easter Sunday, Pentecost Sunday and the other Sundays are listed too.
 */
export function polishHolidays(year: number): Date[] {
  const easter = easterSunday(year)
  const holidays = [
    utc(year, 1, 1),
    ...(year >= 2011 ? [utc(year, 1, 6)] : []),
    easter,
    addDays(easter, 1),
    utc(year, 5, 1),
    utc(year, 5, 3),
    addDays(easter, 49), // Pentecost Sunday
    addDays(easter, 60), // Corpus Christi
    utc(year, 8, 15),
    utc(year, 11, 1),
    utc(year, 11, 11),
    ...(year >= 2025 ? [utc(year, 12, 24)] : []),
    utc(year, 12, 25),
    utc(year, 12, 26),
  ]
  return holidays.sort((x, y) => x.getTime() - y.getTime())
}

const holidayCache = new Map<number, Set<number>>()

function holidaySet(year: number): Set<number> {
  let set = holidayCache.get(year)
  if (!set) {
    set = new Set(polishHolidays(year).map((d) => d.getTime()))
    holidayCache.set(year, set)
  }
  return set
}

/** Monday to Friday that is not a public holiday. The time of day is ignored. */
export function isBusinessDay(date: Date): boolean {
  const day = dayStart(date)
  const weekday = day.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidaySet(day.getUTCFullYear()).has(day.getTime())
}

/** The nearest business day strictly before `date`. */
export function previousBusinessDay(date: Date): Date {
  let day = addDays(dayStart(date), -1)
  while (!isBusinessDay(day)) day = addDays(day, -1)
  return day
}

/** The nearest business day strictly after `date`. */
export function nextBusinessDay(date: Date): Date {
  let day = addDays(dayStart(date), 1)
  while (!isBusinessDay(day)) day = addDays(day, 1)
  return day
}

/** Moves `count` business days (negative = back). `count` 0 returns the day itself. */
export function addBusinessDays(date: Date, count: number): Date {
  let day = dayStart(date)
  const step = count < 0 ? -1 : 1
  for (let left = Math.abs(count); left > 0; left--) {
    day = step === 1 ? nextBusinessDay(day) : previousBusinessDay(day)
  }
  return day
}
