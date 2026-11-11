// lib/domain/reports/types.ts
// The server reports (S12): Cash Flow, P&L, the balances on a day and the dashboard «Гроші зараз». Pure: no Firebase, no
// `server-only`, no next. Money is integer minor units: `...Base` in the company currency, `...Minor` in the account's own.
import type { AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import type { AccountType } from '@/lib/domain/ledger/types'

/** Cash Flow buckets are days up to this many days of the period, months above (the rule the browser report had, S01A). */
export const CASHFLOW_DAY_BUCKETS_MAX_DAYS = 31

/**
 * The longest period a report covers, in days, both ends counted. The ledger accepts operations at most 3650 days ahead
 * (`MAX_FUTURE_DAYS`) and the P&L has a column per month: ten years and a few days is at most 121 columns.
 */
export const MAX_REPORT_DAYS = 3660

/**
 * Documents one report request may read (operations, arrival documents and rollups; every read counts, duplicates too). The
 * counts of all its queries come before the first read, and a request above the cap is `too_many_operations`, never a
 * partial figure. Measured on the emulator (PROGRESS.md, S12, Task 15; synthetic data, production not measured): a filtered
 * Cash Flow of a year read 9 828 documents for 12 000 operations, just under the cap; a filtered P&L reads its payments
 * (the period ±7 days) and its accrual days and periods, about 1.6 documents per operation of the company (4 805 for 3 000),
 * so it refuses a year above roughly 6 000 operations. The no-filter path reads one rollup per account-day with movement
 * plus its `x_` twin, not one per operation (1 582 documents for 12 000 operations), so it is refused only by many
 * accounts moving on many days (see PROGRESS.md, S12 follow-ups). The memory is not the limit: an operation read is
 * under 1 KB, so the cap holds about 10 MB of decoded data.
 */
export const REPORT_SCAN_CAP = 10_000

export const REPORT_KINDS = ['cashflow', 'pl'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const EXPORT_FORMATS = ['csv', 'xlsx'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
/** Where the figures came from: the rollups (no filters, whole months) or the operations of the period. */
export type ReportSource = 'rollups' | 'operations'
export type MoneyType = 'income' | 'expense'

/** What a report is asked for: the period (UTC days, both included) and the report filters of S10f. */
export interface ReportQuery {
  from: string
  to: string
  filters: AnalyticsFilters
}

/** One account's movement on one day: the fields of a `cash_` rollup (or of its `x_` twin). */
export interface CashCell {
  inMinor: number
  outMinor: number
  inBase: number
  outBase: number
  transferInMinor: number
  transferOutMinor: number
}

export interface CategoryAmounts {
  incomeBase: number
  expenseBase: number
}

/** Day (`YYYY-MM-DD`) -> movement. */
export type DayCells = Map<string, CashCell>

/**
 * What a report counts, read from the rollups or recomputed from the operations with the ledger's own rule: the one input
 * of the builders. Category keys are the stored ones (`_none` for an operation without a category).
 */
export interface ReportFacts {
  /** Account id -> its days, counted in analytics. */
  cash: Map<string, DayCells>
  /** The same for the operations excluded from analytics (the `x_cash_` twins). */
  excludedCash: Map<string, DayCells>
  /** Cash Flow by category (payment months of the period, summed). */
  cashCategories: Map<string, CategoryAmounts>
  excludedCashCategories: Map<string, CategoryAmounts>
  /** P&L: accrual month -> category -> amounts. */
  pl: Map<string, Map<string, CategoryAmounts>>
  excludedPl: Map<string, Map<string, CategoryAmounts>>
}

export interface Totals {
  incomeBase: number
  expenseBase: number
}

export interface CashFlowBucket {
  /** `YYYY-MM-DD` (day buckets) or `YYYY-MM` (month buckets). */
  key: string
  incomeBase: number
  expenseBase: number
  netBase: number
  /** The running total of `netBase` from the start of the period. */
  runningNetBase: number
}

/** The balances of an account at the close of the opening and of the closing day, in the account's currency. */
export interface AccountBalance {
  openingMinor: number
  closingMinor: number
}

/**
 * What the report counted on one account, in the account's currency. The row closes when balances are shown:
 * opening + in - out + transfers + excluded = closing (`accountRowGap`).
 */
export interface AccountMovement {
  accountId: string
  inMinor: number
  outMinor: number
  transferInMinor: number
  transferOutMinor: number
  /** The operations excluded from analytics, net (money in minus money out, transfers too); 0 when a concrete tag counts them. */
  excludedNetMinor: number
  /** Null when no balances are shown: a filter other than the accounts makes the row a part of the movement only. */
  openingMinor: number | null
  closingMinor: number | null
}

/** A report row: a category id, or the uncategorised row of its type (`_none:income`, `_none:expense`, `kindRowOf`). */
export interface CategoryLine {
  row: string
  type: MoneyType
  amountBase: number
}

export interface PLLine {
  row: string
  type: MoneyType
  /** One value per month of `PLReport.months`, in that order. */
  values: number[]
  total: number
}

/** An NBP rate as the reports show it (from a `resolveRate` snapshot). */
export interface RateQuote {
  rate: number
  rateDate: string
  tableNo: string | null
  /** False while the table of the day may still be published (a valuation of today). */
  final: boolean
}

/** A rate a report needs: a currency into the company currency, asked for `date` (the S04 rule: the table before it). */
export interface RateNeed {
  currency: string
  date: string
}

export interface CurrencyRates {
  currency: string
  opening: RateQuote | null
  closing: RateQuote | null
}

export interface AccountReconciliation {
  accountId: string
  currency: string
  /** The balance at the close of the opening day and of the closing day (the account's own currency). */
  openingMinor: number
  closingMinor: number
  /** What the report path says the account moved in the period (all its operations, excluded and transfers too). */
  movementMinor: number
  openingBase: number | null
  closingBase: number | null
  /** The transfers of the account in the company currency (at the NBP rate of their days for another currency). */
  transfersBase: number | null
  /** The exchange difference: 0 for the company currency, null without a rate. */
  fxBase: number | null
}

/**
 * The month-end equation (S12): opening + reportNet + excluded + outsideFilter + transfers + fx = closing, all in the
 * company currency; `discrepancyBase` is what is left (0 when the balances agree with the movement).
 */
export interface Reconciliation {
  /** The close of the day before the period, at most today. */
  openingDay: string
  /** The close of the last day of the period, at most today. */
  closingDay: string
  /** False when a rate is missing: the lines that need it are null and `missingRates` says which. */
  valued: boolean
  missingRates: RateNeed[]
  openingBase: number | null
  /** Income minus expense the report counts (the Cash Flow totals). */
  reportNetBase: number
  /** Excluded from analytics: their net; null when a concrete tag already counts them in the report. */
  excludedBase: number | null
  excludedIncluded: boolean
  /** The income and expense of the chosen accounts the filters leave out (0 without filters other than accounts). */
  outsideFilterBase: number
  transfersBase: number | null
  fxBase: number | null
  closingBase: number | null
  discrepancyBase: number | null
  accounts: AccountReconciliation[]
  /** The opening and closing rates of each foreign currency of the chosen accounts. */
  rates: CurrencyRates[]
}

export interface Coverage {
  source: ReportSource
  operationsRead: number
  rollupsRead: number
  /** Operations read that could not be counted (malformed, or another currency without base amounts); null on the rollups path, which cannot see them. */
  uncountable: number | null
}

export interface CashFlowReport {
  kind: 'cashflow'
  from: string
  to: string
  /** The company currency of every `...Base` amount. */
  currency: string
  granularity: 'day' | 'month'
  totals: { incomeBase: number; expenseBase: number; netBase: number }
  buckets: CashFlowBucket[]
  /** One line per chosen account (every account without an account filter). */
  accounts: AccountMovement[]
  categories: CategoryLine[]
  /** «Виключено з аналітики»: what the report left out; null when a concrete tag counts them in. */
  excluded: Totals | null
  includeExcluded: boolean
  /** An excluded operation was counted (the S10f hint). */
  excludedCounted: boolean
  reconciliation: Reconciliation
  coverage: Coverage
}

export interface PLReport {
  kind: 'pl'
  from: string
  to: string
  currency: string
  /** `YYYY-MM`, oldest first: the columns. */
  months: string[]
  rows: PLLine[]
  totals: { incomeBase: number; expenseBase: number; profitBase: number }
  excluded: Totals | null
  includeExcluded: boolean
  excludedCounted: boolean
  reconciliation: Reconciliation
  coverage: Coverage
}

export type AnyReport = CashFlowReport | PLReport

export interface BalanceLine {
  accountId: string
  name: string
  type: AccountType
  currency: string
  color: string
  balanceMinor: number
  /** In the company currency; null when no NBP rate could be had. */
  baseMinor: number | null
}

export interface CurrencyTotal {
  currency: string
  balanceMinor: number
  /** The sum of the lines in the company currency (null when one is missing). */
  baseMinor: number | null
  /** Null for the company currency and without a rate. */
  rate: RateQuote | null
}

export interface BalancesReport {
  /** The close of this day (at most today). */
  date: string
  currency: string
  accounts: BalanceLine[]
  /** The sum of the valued lines. */
  totalBase: number
  /** Every line is valued. */
  complete: boolean
  byCurrency: CurrencyTotal[]
}

export interface BankSync {
  accountId: string
  /** ISO time of the last bank sync of the account's active link, null when it never ran. */
  lastSyncAt: string | null
}

export interface DashboardReport extends BalancesReport {
  bank: BankSync[]
}
