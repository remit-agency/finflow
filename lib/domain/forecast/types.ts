import type { PlannedRow } from '@/lib/domain/recurring/types'

/** The forecast reaches this many days after today (today included as day 0). */
export const FORECAST_DAYS = 90
/** The largest planned payments of the gap day the banner may name. */
export const MAX_CAUSES = 3
/** Payments one day panel lists at most. */
export const DAY_ROWS = 100
/** The years a calendar month may be read for (the API and the calendar page share this range). */
export const CALENDAR_MIN_YEAR = 2000
export const CALENDAR_MAX_YEAR = 2100

/** One planned payment that pushes the balance down on the gap day. */
export interface GapCause {
  id: string
  type: 'income' | 'expense'
  amountMinor: number
  currency: string
  /** The amount in the company currency (the latest NBP rate for another currency). */
  baseMinor: number
  /** The series name, else the comment; null when the payment has neither. */
  label: string | null
}

export interface ForecastDay {
  date: string
  plannedIncomeBase: number
  plannedExpenseBase: number
  /** The forecast total of every account in the company currency at the close of the day. */
  endBalanceBase: number
}

/** The first day the forecast total is below the company minimum. */
export interface CashGap {
  date: string
  balanceBase: number
  minimumBase: number
  /** `minimumBase - balanceBase`, always positive. */
  shortfallBase: number
  /** The largest planned expenses of that day (at most MAX_CAUSES), largest first; empty when none is planned that day. */
  causes: GapCause[]
}

export interface Forecast {
  /** The Warsaw day the forecast starts on. */
  today: string
  currency: string
  minimumBase: number
  /** The total of the valued accounts now. */
  startBase: number
  /** FORECAST_DAYS + 1 days, from today. */
  days: ForecastDay[]
  gap: CashGap | null
  /** The day of the lowest forecast balance (the first one on a tie). */
  lowest: { date: string; balanceBase: number }
  /** A foreign-currency account or payment was converted at the latest NBP rate. */
  approximate: boolean
  /** Accounts or planned payments left out because no rate was available. */
  unvalued: number
  /** A planned-payments read stopped at its limit: the forecast may be incomplete. */
  truncated: boolean
}

/** One day of a payment calendar month. */
export interface CalendarDay {
  date: string
  kind: 'past' | 'today' | 'future'
  /** What happened (income and expense counted in analytics, in the company currency). */
  incomeBase: number
  expenseBase: number
  /** What is planned that day (transfers left out). */
  plannedIncomeBase: number
  plannedExpenseBase: number
  /** Planned payments dated before today (still unpaid). */
  overdueCount: number
  /** Past days: the real total at the close; today and the next FORECAST_DAYS: the forecast; later: null. */
  endBalanceBase: number | null
  /** The forecast total is below the minimum on this day. */
  belowMinimum: boolean
  /** The first day of the cash gap. */
  gap: boolean
}

export interface CalendarMonth {
  year: number
  /** 1-12. */
  month: number
  today: string
  currency: string
  minimumBase: number
  days: CalendarDay[]
  gapDate: string | null
  approximate: boolean
  unvalued: number
  truncated: boolean
}

/** One operation of a day, as the day panel lists it. */
export interface DayActual {
  id: string
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  amountMinor: number
  currency: string
  description?: string
}

export interface DayPayments {
  date: string
  /** Planned operations of the day (the rows the plan actions take). */
  planned: PlannedRow[]
  actual: DayActual[]
  /** The series names of the planned rows. */
  names: Record<string, string>
  /** More operations exist than DAY_ROWS. */
  truncated: boolean
}
