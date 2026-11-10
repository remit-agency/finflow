import type { Schedule } from '@/lib/domain/recurring/types'
import type { Locale } from '@/lib/i18n/config'
import { formatDate, formatWeekday } from '@/lib/i18n/format'

/** A weekday 1 (Monday) ... 7 as a Date: 2026-11-16 is a Monday. */
export function weekdayDate(weekday: number): Date {
  return new Date(Date.UTC(2026, 10, 15 + weekday))
}

/** The message `recurring.repeat.<key>` and its values that describe a schedule («Щомісяця, 15-го»). */
export function repeatOf(s: Schedule, locale: Locale): { key: 'weekly' | 'monthly' | 'everyNMonths' | 'yearly'; values: Record<string, string | number> } {
  switch (s.frequency) {
    case 'weekly':
      return { key: 'weekly', values: { weekday: formatWeekday(weekdayDate(s.weekday ?? 1), locale, 'long') } }
    case 'monthly':
      return { key: 'monthly', values: { day: s.dayOfMonth ?? 1 } }
    case 'everyNMonths':
      return { key: 'everyNMonths', values: { interval: s.interval, day: s.dayOfMonth ?? 1 } }
    case 'yearly':
      // 2000 is a leap year, so 29 February has a date to show.
      return { key: 'yearly', values: { date: formatDate(new Date(Date.UTC(2000, Number(s.startDate.slice(5, 7)) - 1, s.dayOfMonth ?? 1)), locale, { day: 'numeric', month: 'long' }) } }
  }
}
