import { monthBounds } from '@/lib/domain/ledger/days'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { baseOf } from './build'
import type { CalendarDay, CalendarMonth, Forecast } from './types'

export interface CalendarInput {
  year: number
  /** 1-12. */
  month: number
  today: string
  currency: string
  /** Day -> what happened, in the company currency (the rollups of the month). */
  movement: ReadonlyMap<string, { incomeBase: number; expenseBase: number }>
  /** The planned operations dated in the month. */
  planned: readonly PlannedRow[]
  /** Currency -> the latest rate to the company currency. */
  rates: ReadonlyMap<string, number>
  /** Day -> the real total at the close (null: an account has no rate). Days up to today only. */
  pastBalances: ReadonlyMap<string, number | null>
  forecast: Forecast
}

const pad = (n: number): string => String(n).padStart(2, '0')

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * One month of the payment calendar (S13): what happened, what is planned, the end-of-day balance (the real one up to
 * yesterday, the forecast from today to the end of the forecast, none after it) and the cash gap day.
 */
export function buildCalendarMonth(input: CalendarInput): CalendarMonth {
  const { year, month, today, forecast } = input
  const plannedIncome = new Map<string, number>()
  const plannedExpense = new Map<string, number>()
  const overdue = new Map<string, number>()
  // The forecast already counts the overdue rows and those up to its last day; only a row beyond it is not in `forecast`.
  const lastForecastDay = forecast.days[forecast.days.length - 1].date
  let unvalued = forecast.unvalued
  let approximate = forecast.approximate
  for (const row of input.planned) {
    if (row.type === 'transfer') continue
    const beyond = row.paymentDate > lastForecastDay
    const base = baseOf(row.amountMinor, row.currency, input.currency, input.rates)
    if (base === null) {
      if (beyond) unvalued += 1
      continue
    }
    if (beyond && row.currency !== input.currency) approximate = true
    const sums = row.type === 'income' ? plannedIncome : plannedExpense
    sums.set(row.paymentDate, (sums.get(row.paymentDate) ?? 0) + base)
    if (row.paymentDate < today) overdue.set(row.paymentDate, (overdue.get(row.paymentDate) ?? 0) + 1)
  }
  const forecastByDay = new Map(forecast.days.map((d) => [d.date, d]))
  const days: CalendarDay[] = []
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`
    const kind = date < today ? 'past' : date === today ? 'today' : 'future'
    const moved = input.movement.get(date)
    const fd = forecastByDay.get(date)
    const endBalanceBase = kind === 'past' ? (input.pastBalances.get(date) ?? null) : (fd?.endBalanceBase ?? null)
    days.push({
      date,
      kind,
      incomeBase: moved?.incomeBase ?? 0,
      expenseBase: moved?.expenseBase ?? 0,
      plannedIncomeBase: plannedIncome.get(date) ?? 0,
      plannedExpenseBase: plannedExpense.get(date) ?? 0,
      overdueCount: overdue.get(date) ?? 0,
      endBalanceBase,
      belowMinimum: kind !== 'past' && endBalanceBase !== null && endBalanceBase < forecast.minimumBase,
      gap: forecast.gap?.date === date,
    })
  }
  return {
    year,
    month,
    today,
    currency: input.currency,
    minimumBase: forecast.minimumBase,
    days,
    gapDate: forecast.gap?.date ?? null,
    approximate,
    unvalued,
    truncated: forecast.truncated,
  }
}

/** The first and last day of a month. */
export function monthRange(year: number, month: number): { first: string; last: string } {
  return monthBounds(`${year}-${pad(month)}`)
}
