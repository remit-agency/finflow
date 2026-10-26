import { formatDate, formatWeekday } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/config'
import type { Transaction } from '@/types'

/**
 * Day and month of a transaction date in UTC, in the UI language. The journal groups transactions
 * by their UTC day (`toDateKey`), so a row must be formatted in UTC too, otherwise a row at 00:00Z
 * reads as the previous day west of Greenwich while its group header shows the right one.
 */
export function formatDayShortUtc(date: Date, locale: Locale): string {
  return formatDate(date, locale, { day: 'numeric', month: 'short' })
}

/** Short weekday of a transaction date in UTC (`пт`), for the same reason as `formatDayShortUtc`. */
export function formatWeekdayShortUtc(date: Date, locale: Locale): string {
  return formatWeekday(date, locale, 'short')
}

/**
 * Net amount of one journal day: income minus expense; transfers move money between own
 * accounts and do not count. Returns null when the day's non-transfer transactions use more than
 * one currency (a sum would be meaningless; conversion belongs to S04) or when there are no
 * transactions. A transfer-only day totals exactly 0 in the currency of its first transfer.
 */
export function summarizeDay(
  txs: ReadonlyArray<Pick<Transaction, 'type' | 'amount' | 'currency'>>,
): { total: number; currency: string } | null {
  if (txs.length === 0) return null
  const counted = txs.filter((t) => t.type !== 'transfer')
  const currencies = new Set(counted.map((t) => t.currency))
  if (currencies.size > 1) return null

  const currency = counted[0]?.currency ?? txs[0].currency
  const cents = counted.reduce(
    (sum, t) => sum + (t.type === 'income' ? 1 : -1) * Math.round(t.amount * 100),
    0,
  )
  return { total: cents / 100, currency }
}
