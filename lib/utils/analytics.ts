import { formatDate } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/config'

// Cash Flow, P&L and the payment calendar are server reports (lib/domain/reports, lib/server/reports, lib/domain/forecast);
// what stays here is the view types the charts and tables draw and the labels of their buckets and columns.

/** One Cash Flow bucket as the chart and the table draw it (major units of the company currency; `cashFlowBuckets`). */
export interface CashFlowBucket {
  label: string       // month: "Січ 26"; day: "12 жов" (in the UI language)
  key: string         // month: "2026-01"; day: "2026-01-12" (UTC)
  income: number
  expense: number
  balance: number     // running total of `net` from the start of the period
  net: number         // income - expense
}

/** One P&L row as the table and the charts draw it (major units; `plRows`). */
export interface PLRow {
  categoryId: string
  categoryName: string
  type: 'income' | 'expense'
  months: Record<string, number>  // { "2026-01": 5000, "2026-02": 3200 }
  total: number
}

/** «Січ» / «Sty» / «Jan»: the first three letters of the language's month name, capitalised. */
function shortMonthName(year: number, month: number, locale: Locale): string {
  const name = formatDate(new Date(Date.UTC(year, month, 1)), locale, { month: 'long' })
  const short = name.slice(0, 3)
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/**
 * «Січ 26» (a month bucket / a P&L column); `month` is 0-based. English writes the full year
 * («Oct 2026»): «Oct 26» reads as the 26th of October.
 */
export function formatMonthLabel(year: number, month: number, locale: Locale): string {
  const yearText = locale === 'en' ? String(year) : String(year).slice(2)
  return `${shortMonthName(year, month, locale)} ${yearText}`
}

/** «12 жов» / «12 Oct» (a day bucket): lowercase month in Ukrainian and Polish, as the month name is written there. */
export function formatDayLabel(date: Date, locale: Locale): string {
  const month = shortMonthName(date.getUTCFullYear(), date.getUTCMonth(), locale)
  return `${date.getUTCDate()} ${locale === 'en' ? month : month.toLowerCase()}`
}
