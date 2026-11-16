import { addDays } from '@/lib/domain/ledger/days'
import { mulRate } from '@/lib/domain/ledger/money'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { FORECAST_DAYS, MAX_CAUSES, type CashGap, type Forecast, type ForecastDay, type GapCause } from './types'

export interface ForecastInput {
  /** The Warsaw day. */
  today: string
  baseCurrency: string
  /** The company minimum, in the company currency. */
  minimumMinor: number
  /** The total of the valued accounts now, in the company currency. */
  startBase: number
  /** An account has no rate: its balance is not in `startBase`. */
  startIncomplete: boolean
  /** An account in another currency exists (its balance was converted). */
  foreignAccounts: boolean
  /** The overdue planned payments and those up to the last forecast day. */
  planned: readonly PlannedRow[]
  /** Currency -> the latest rate to the company currency. */
  rates: ReadonlyMap<string, number>
  /** Series id -> name. */
  names: Readonly<Record<string, string>>
  /** A planned-payments read stopped at its limit. */
  truncated: boolean
  /** Tests: another horizon. */
  days?: number
}

/** The amount in the company currency, or null when its currency has no rate. */
export function baseOf(amountMinor: number, currency: string, baseCurrency: string, rates: ReadonlyMap<string, number>): number | null {
  if (currency === baseCurrency) return amountMinor
  const rate = rates.get(currency)
  return rate === undefined ? null : mulRate(amountMinor, rate)
}

/**
 * The balance forecast (S13): today's total plus the planned payments by day. An overdue payment counts on today (the money
 * is still going to leave); an own-account transfer does not change the total; a payment after the horizon is not counted.
 * The cash gap is the first day the total is below the company minimum.
 */
export function buildForecast(input: ForecastInput): Forecast {
  const { today, baseCurrency } = input
  const horizon = input.days ?? FORECAST_DAYS
  const last = addDays(today, horizon)
  let approximate = input.foreignAccounts
  let unvalued = input.startIncomplete ? 1 : 0
  const income = new Map<string, number>()
  const expense = new Map<string, number>()
  const byDay = new Map<string, { row: PlannedRow; base: number }[]>()
  for (const row of input.planned) {
    if (row.type === 'transfer') continue
    const day = row.paymentDate < today ? today : row.paymentDate
    if (day > last) continue
    const base = baseOf(row.amountMinor, row.currency, baseCurrency, input.rates)
    if (base === null) {
      unvalued += 1
      continue
    }
    if (row.currency !== baseCurrency) approximate = true
    const sums = row.type === 'income' ? income : expense
    sums.set(day, (sums.get(day) ?? 0) + base)
    byDay.set(day, [...(byDay.get(day) ?? []), { row, base }])
  }

  const days: ForecastDay[] = []
  let balance = input.startBase
  let lowest = { date: today, balanceBase: Number.POSITIVE_INFINITY }
  let gap: CashGap | null = null
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(today, i)
    const plannedIncomeBase = income.get(date) ?? 0
    const plannedExpenseBase = expense.get(date) ?? 0
    balance += plannedIncomeBase - plannedExpenseBase
    days.push({ date, plannedIncomeBase, plannedExpenseBase, endBalanceBase: balance })
    if (balance < lowest.balanceBase) lowest = { date, balanceBase: balance }
    if (gap === null && balance < input.minimumMinor) {
      gap = { date, balanceBase: balance, minimumBase: input.minimumMinor, shortfallBase: input.minimumMinor - balance, causes: causesOf(byDay.get(date) ?? [], input.names) }
    }
  }
  return {
    today,
    currency: baseCurrency,
    minimumBase: input.minimumMinor,
    startBase: input.startBase,
    days,
    gap,
    lowest,
    approximate,
    unvalued,
    truncated: input.truncated,
  }
}

/** The largest expenses of a day, largest first (ties keep the read order). */
function causesOf(rows: readonly { row: PlannedRow; base: number }[], names: Readonly<Record<string, string>>): GapCause[] {
  return rows
    .filter(({ row }) => row.type === 'expense')
    .sort((a, b) => b.base - a.base)
    .slice(0, MAX_CAUSES)
    .map(({ row, base }) => ({
      id: row.id,
      type: 'expense' as const,
      amountMinor: row.amountMinor,
      currency: row.currency,
      baseMinor: base,
      label: (row.seriesId !== undefined ? names[row.seriesId] : undefined) ?? row.description ?? null,
    }))
}
