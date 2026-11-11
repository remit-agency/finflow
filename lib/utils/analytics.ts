import type { Transaction } from '@/types'
import { countsInAnalytics, type AnalyticsSelection } from '@/lib/domain/analytics-filter/filter'
import { formatDate } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/config'

// Cash Flow and P&L are server reports since S12 (lib/domain/reports, lib/server/reports); what stays here is the view
// types the charts and tables draw, the labels of their buckets and columns, and the Calendar (a browser report until S13).

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

export interface CalendarReport {
  /** The days of the month shown. */
  days: DayData[]
  /**
   * An operation excluded from analytics was counted: on one of the days, or in the balance carried in from before the
   * month (the days show that balance). The page's hint (S10f).
   */
  excludedCounted: boolean
}

export interface DayData {
  date: string        // "2026-04-06"
  income: number
  expense: number
  balance: number     // running end-of-day balance
  hasTransactions: boolean
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

/**
 * The days of a month (`month` 0-based) with their income, expense and running balance. Transfers do not count, nor do
 * operations excluded from analytics unless the selection includes them (`includeExcluded`) (S10f closes the gap S10t left here): neither in the days
 * nor in the balance carried in from before the month.
 */
export function buildCalendar(selection: AnalyticsSelection<Transaction>, year: number, month: number): CalendarReport {
  const { operations: transactions, includeExcluded } = selection
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const result: DayData[] = []
  let excludedCounted = false

  // Get running balance up to start of month
  let startingBalance = 0
  for (const tx of transactions) {
    if (!countsInAnalytics(tx, includeExcluded)) continue
    const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
    if (date.getFullYear() < year || (date.getFullYear() === year && date.getMonth() < month)) {
      if (tx.type === 'income') startingBalance += tx.amount
      else if (tx.type === 'expense') startingBalance -= tx.amount
      else continue
      if (tx.excluded === true) excludedCounted = true
    }
  }

  let runningBalance = startingBalance

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    let income = 0
    let expense = 0

    for (const tx of transactions) {
      if (!countsInAnalytics(tx, includeExcluded)) continue
      const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
      const txDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      if (txDateStr === dateStr) {
        if (tx.type === 'income') income += tx.amount
        else if (tx.type === 'expense') expense += tx.amount
        else continue
        if (tx.excluded === true) excludedCounted = true
      }
    }

    runningBalance += income - expense

    result.push({
      date: dateStr,
      income,
      expense,
      balance: runningBalance,
      hasTransactions: income > 0 || expense > 0,
    })
  }

  return { days: result, excludedCounted }
}
