import { Transaction, Account, Category } from '@/types'
import {
  DAY_MS,
  addDaysUtc,
  dayKeyUtc,
  endOfDayUtc,
  shiftMonth,
  startOfDayUtc,
  type YearMonth,
} from '@/lib/utils/calendar-grid'
import type { PeriodRange } from '@/lib/utils/period'
import { formatDate } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/config'

/** Cash Flow buckets are months for a range longer than this many days, days otherwise. */
export const CASHFLOW_DAY_BUCKETS_MAX_DAYS = 31

export type CashFlowGranularity = 'month' | 'day'

export interface CashFlowBucket {
  label: string       // month: "Січ 26"; day: "12 жов" (in the UI language)
  key: string         // month: "2026-01"; day: "2026-01-12" (UTC)
  income: number
  expense: number
  balance: number     // running balance from the start of the range
  net: number         // income - expense
}

export interface CashFlowReport {
  granularity: CashFlowGranularity
  buckets: CashFlowBucket[]
}

export interface PLRow {
  categoryId: string
  categoryName: string
  type: 'income' | 'expense'
  months: Record<string, number>  // { "2026-01": 5000, "2026-02": 3200 }
  total: number
}

export interface PLReport {
  /** The months of the range, oldest first ("2026-01"); the table's columns. */
  monthKeys: string[]
  rows: PLRow[]
}

export interface DayData {
  date: string        // "2026-04-06"
  income: number
  expense: number
  balance: number     // running end-of-day balance
  hasTransactions: boolean
}

export interface BalanceData {
  totalAssets: number
  totalBalance: number
  accounts: Account[]
}

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
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
function formatDayLabel(date: Date, locale: Locale): string {
  const month = shortMonthName(date.getUTCFullYear(), date.getUTCMonth(), locale)
  return `${date.getUTCDate()} ${locale === 'en' ? month : month.toLowerCase()}`
}

function txDate(tx: Pick<Transaction, 'date'>): Date {
  return tx.date instanceof Date ? tx.date : new Date(tx.date)
}

function monthKeyUtc(date: Date): string {
  return formatMonthKey(date.getUTCFullYear(), date.getUTCMonth())
}

/**
 * The closed range a report covers. A bounded range is used as is; an open side (`allTime`, the
 * journal's future filter) takes the first / last transaction's UTC day. Null when nothing is left
 * to show (no transactions for an open range, or an empty range).
 */
function reportRange(range: PeriodRange, transactions: Transaction[]): { start: Date; end: Date } | null {
  let { start, end } = range
  if (!start || !end) {
    let min = Infinity
    let max = -Infinity
    for (const tx of transactions) {
      const t = txDate(tx).getTime()
      if (t < min) min = t
      if (t > max) max = t
    }
    if (min === Infinity) return null
    start ??= startOfDayUtc(new Date(min))
    end ??= endOfDayUtc(new Date(max))
  }
  return start.getTime() <= end.getTime() ? { start, end } : null
}

function inRange(tx: Transaction, range: { start: Date; end: Date }): boolean {
  const t = txDate(tx).getTime()
  return t >= range.start.getTime() && t <= range.end.getTime()
}

/** The UTC months a range touches, oldest first. */
function monthsOf(range: { start: Date; end: Date }): YearMonth[] {
  const last: YearMonth = { year: range.end.getUTCFullYear(), month: range.end.getUTCMonth() }
  const months: YearMonth[] = []
  for (
    let ym: YearMonth = { year: range.start.getUTCFullYear(), month: range.start.getUTCMonth() };
    ym.year < last.year || (ym.year === last.year && ym.month <= last.month);
    ym = shiftMonth(ym, 1)
  ) {
    months.push(ym)
  }
  return months
}

/** Number of UTC calendar days of a range (both ends included). */
function daysOf(range: { start: Date; end: Date }): number {
  return Math.round((startOfDayUtc(range.end).getTime() - startOfDayUtc(range.start).getTime()) / DAY_MS) + 1
}

/**
 * Cash Flow over a resolved period (`resolvePeriod`): transactions outside the range are left
 * out; buckets are UTC months when the range is longer than 31 days and UTC days otherwise.
 * Transfers do not count. `balance` is the running total of `net` from the start of the range.
 * `locale` (the UI language) only decides the bucket labels.
 */
export function buildCashFlow(transactions: Transaction[], range: PeriodRange, locale: Locale): CashFlowReport {
  const bounded = reportRange(range, transactions)
  if (!bounded) return { granularity: 'month', buckets: [] }

  const granularity: CashFlowGranularity =
    daysOf(bounded) > CASHFLOW_DAY_BUCKETS_MAX_DAYS ? 'month' : 'day'
  const buckets: CashFlowBucket[] = []
  const empty = { income: 0, expense: 0, balance: 0, net: 0 }

  if (granularity === 'month') {
    for (const { year, month } of monthsOf(bounded)) {
      buckets.push({ label: formatMonthLabel(year, month, locale), key: formatMonthKey(year, month), ...empty })
    }
  } else {
    for (let d = startOfDayUtc(bounded.start); d.getTime() <= bounded.end.getTime(); d = addDaysUtc(d, 1)) {
      buckets.push({ label: formatDayLabel(d, locale), key: dayKeyUtc(d), ...empty })
    }
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]))
  const keyOf = granularity === 'month' ? monthKeyUtc : dayKeyUtc
  for (const tx of transactions) {
    if (!inRange(tx, bounded)) continue
    const entry = byKey.get(keyOf(txDate(tx)))
    if (!entry) continue
    if (tx.type === 'income') entry.income += tx.amount
    else if (tx.type === 'expense') entry.expense += tx.amount
  }

  // Net and the running balance
  let runningBalance = 0
  for (const entry of buckets) {
    entry.net = entry.income - entry.expense
    runningBalance += entry.net
    entry.balance = runningBalance
  }

  return { granularity, buckets }
}

/**
 * P&L over a resolved period: income and expense by category for the transactions inside the
 * range, split by the UTC months the range touches (the table's columns) with a total per row.
 * Transfers do not count; transactions without a known category go to two rows (income and
 * expense) named `uncategorizedName` (the translated «Без категорії»). `nameOf` is the label of a
 * category row (the UI passes the localized name); it defaults to the stored name.
 */
export function buildPL(
  transactions: Transaction[],
  categories: Category[],
  range: PeriodRange,
  uncategorizedName: string,
  nameOf: (category: Category) => string = (category) => category.name
): PLReport {
  const bounded = reportRange(range, transactions)
  if (!bounded) return { monthKeys: [], rows: [] }
  const monthKeys = monthsOf(bounded).map(({ year, month }) => formatMonthKey(year, month))

  const rowMap = new Map<string, PLRow>()

  // Initialize rows for all categories
  for (const cat of categories) {
    const months: Record<string, number> = {}
    for (const key of monthKeys) months[key] = 0
    rowMap.set(cat.id, {
      categoryId: cat.id,
      categoryName: nameOf(cat),
      type: cat.type,
      months,
      total: 0,
    })
  }

  // Uncategorized buckets
  const uncatIncome: PLRow = {
    categoryId: '__uncategorized_income',
    categoryName: uncategorizedName,
    type: 'income',
    months: Object.fromEntries(monthKeys.map(k => [k, 0])),
    total: 0,
  }
  const uncatExpense: PLRow = {
    categoryId: '__uncategorized_expense',
    categoryName: uncategorizedName,
    type: 'expense',
    months: Object.fromEntries(monthKeys.map(k => [k, 0])),
    total: 0,
  }

  // Aggregate
  for (const tx of transactions) {
    if (tx.type === 'transfer') continue
    if (!inRange(tx, bounded)) continue
    const key = monthKeyUtc(txDate(tx))

    if (tx.categoryId && rowMap.has(tx.categoryId)) {
      const row = rowMap.get(tx.categoryId)!
      row.months[key] = (row.months[key] || 0) + tx.amount
      row.total += tx.amount
    } else {
      const bucket = tx.type === 'income' ? uncatIncome : uncatExpense
      bucket.months[key] = (bucket.months[key] || 0) + tx.amount
      bucket.total += tx.amount
    }
  }

  const rows = Array.from(rowMap.values()).filter(r => r.total > 0)

  // Add uncategorized if has data
  if (uncatIncome.total > 0) rows.push(uncatIncome)
  if (uncatExpense.total > 0) rows.push(uncatExpense)

  return { monthKeys, rows }
}

export function buildCalendar(
  transactions: Transaction[],
  year: number,
  month: number
): DayData[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const result: DayData[] = []

  // Get running balance up to start of month
  let startingBalance = 0
  for (const tx of transactions) {
    const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
    if (date.getFullYear() < year || (date.getFullYear() === year && date.getMonth() < month)) {
      if (tx.type === 'income') startingBalance += tx.amount
      else if (tx.type === 'expense') startingBalance -= tx.amount
    }
  }

  let runningBalance = startingBalance

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    let income = 0
    let expense = 0

    for (const tx of transactions) {
      const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
      const txDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      if (txDateStr === dateStr) {
        if (tx.type === 'income') income += tx.amount
        else if (tx.type === 'expense') expense += tx.amount
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

  return result
}

export function buildBalance(accounts: Account[]): BalanceData {
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0)
  return {
    totalAssets: totalBalance,
    totalBalance,
    accounts,
  }
}
