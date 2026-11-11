// lib/utils/report-view.ts
// The server reports (S12) as the pages and the export show them: labels of the period keys, the query of the toolbar,
// the rows the charts and tables already draw (major units), the account order of the sidebar and the «Станом на» days.
// Intl formatting stays in lib/utils and lib/i18n.
import type { AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { monthBounds, monthOf, prevMonth } from '@/lib/domain/ledger/days'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { AccountType } from '@/lib/domain/ledger/types'
import { rowRank } from '@/lib/domain/reports/categories'
import type { BalancesReport, CashFlowReport, PLReport, ReportQuery } from '@/lib/domain/reports/types'
import type { Locale } from '@/lib/i18n/config'
import type { Category } from '@/types'
import { formatDayLabel, formatMonthLabel, type CashFlowBucket, type PLRow } from './analytics'
import { dayKeyUtc } from './calendar-grid'
import { resolvePeriod, type PeriodSelection } from './period'

/** A day (`YYYY-MM-DD`) or a month (`YYYY-MM`) of a report as its label in the UI language («19 жов», «Жов 26»). */
export function periodKeyLabel(key: string, locale: Locale): string {
  const [year, month, day] = key.split('-').map(Number)
  return day === undefined ? formatMonthLabel(year, month - 1, locale) : formatDayLabel(new Date(Date.UTC(year, month - 1, day)), locale)
}

/** The report query of the toolbar's period (resolved against Warsaw's today) with the filters of the address. */
export function reportQueryOf(period: PeriodSelection, now: Date, filters: AnalyticsFilters): ReportQuery {
  const range = resolvePeriod(period, now)
  if (!range.start || !range.end) throw new RangeError('a report needs a bounded period')
  return { from: dayKeyUtc(range.start), to: dayKeyUtc(range.end), filters }
}

/** The buckets as the chart and the table draw them: major units of the company currency, labelled in the UI language. */
export function cashFlowBuckets(report: CashFlowReport, locale: Locale): CashFlowBucket[] {
  return report.buckets.map((b) => ({
    key: b.key,
    label: periodKeyLabel(b.key, locale),
    income: fromMinor(b.incomeBase),
    expense: fromMinor(b.expenseBase),
    net: fromMinor(b.netBase),
    balance: fromMinor(b.runningNetBase),
  }))
}

/** The P&L rows as the table and the charts draw them, in the order of the company's categories (the shell's list). */
export function plRows(report: PLReport, categories: readonly Category[], nameOf: (category: Category) => string, noCategory: string): { monthKeys: string[]; rows: PLRow[] } {
  const rank = rowRank(categories)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rows = [...report.rows]
    .sort((a, b) => (a.type === b.type ? rank(a.type, a.row) - rank(b.type, b.row) : a.type === 'income' ? -1 : 1))
    .map((line): PLRow => {
      const category = byId.get(line.row)
      return {
        categoryId: line.row,
        categoryName: category ? nameOf(category) : noCategory,
        type: line.type,
        months: Object.fromEntries(report.months.map((month, i) => [month, fromMinor(line.values[i])])),
        total: fromMinor(line.total),
      }
    })
  return { monthKeys: report.months, rows }
}

/** Lines in the order of the sidebar's accounts; accounts it does not know (yet) come last. */
export function inShellOrder<T extends { accountId: string }>(lines: readonly T[], accounts: ReadonlyArray<{ id: string }>): T[] {
  const index = new Map(accounts.map((a, i) => [a.id, i]))
  return [...lines].sort((a, b) => (index.get(a.accountId) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.accountId) ?? Number.MAX_SAFE_INTEGER))
}

/** «Станом на» of the Balance page (label `analytics.balance.asOfOptions.<option>`). */
export const AS_OF_OPTIONS = ['today', 'prevMonthEnd', 'prevQuarterEnd', 'prevYearEnd'] as const
export type AsOfOption = (typeof AS_OF_OPTIONS)[number]

export function asOfDay(option: AsOfOption, today: string): string {
  const month = monthOf(today)
  switch (option) {
    case 'today':
      return today
    case 'prevMonthEnd':
      return monthBounds(prevMonth(month)).last
    case 'prevQuarterEnd': {
      const [year, m] = month.split('-').map(Number)
      const firstOfQuarter = `${year}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}`
      return monthBounds(prevMonth(firstOfQuarter)).last
    }
    case 'prevYearEnd':
      return `${Number(today.slice(0, 4)) - 1}-12-31`
  }
}

/** One account of the Balance sheet: its own currency and the company currency (null without an NBP rate). */
export interface BalanceSheetLine {
  id: string
  name: string
  type: AccountType
  color: string
  currency: string
  balance: number
  base: number | null
  balanceMinor: number
  baseMinor: number | null
}

export function balanceSheetLines(report: BalancesReport, accounts: ReadonlyArray<{ id: string }>): BalanceSheetLine[] {
  return inShellOrder(report.accounts, accounts).map((l) => ({
    id: l.accountId,
    name: l.name,
    type: l.type,
    color: l.color,
    currency: l.currency,
    balance: fromMinor(l.balanceMinor),
    base: l.baseMinor === null ? null : fromMinor(l.baseMinor),
    balanceMinor: l.balanceMinor,
    baseMinor: l.baseMinor,
  }))
}
