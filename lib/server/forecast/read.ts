import type { Firestore, Query } from 'firebase-admin/firestore'
import { buildCalendarMonth, monthRange } from '@/lib/domain/forecast/calendar'
import { buildForecast, type ForecastInput } from '@/lib/domain/forecast/build'
import { DAY_ROWS, FORECAST_DAYS, type CalendarMonth, type DayActual, type DayPayments, type Forecast } from '@/lib/domain/forecast/types'
import { addDays } from '@/lib/domain/ledger/days'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { flatten, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { balanceRates, balancesReport } from '@/lib/domain/reports/balances'
import { ReportError } from '@/lib/domain/reports/errors'
import { factsFromRollupDocs, selectRollupDocs } from '@/lib/domain/reports/facts'
import { rateKey, valuationDate } from '@/lib/domain/reports/reconcile'
import { REPORT_SCAN_CAP } from '@/lib/domain/reports/types'
import { parsePlannedRow, ROW_FIELDS } from '@/lib/domain/recurring/rows'
import { MAX_SERIES, PLANNED_SCAN, type PlannedRow } from '@/lib/domain/recurring/types'
import { balancesAt, countArrivals, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { recurringCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readSnapshot, type Reader } from '@/lib/server/ledger/reader'
import { overdueQuery } from '@/lib/server/recurring/read'
import { cellsQuery, readContext, type ReportContext } from '@/lib/server/reports/read'
import { quoteRates } from '@/lib/server/reports/rates'

type ReadDeps = Pick<LedgerDeps, 'db' | 'today' | 'resolveRate'>

/** Planned operations paid from `from` to `to`, by payment day (the index `transactions (status, paymentDate)` of S11). */
function plannedBetween(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '>=', from).where('paymentDate', '<=', to).orderBy('paymentDate')
}

const nonNull = <T>(v: T | null): v is T => v !== null

/** What the forecast is built from, read through one `Reader` (one snapshot). */
interface ForecastInputs {
  today: string
  context: ReportContext
  /** The overdue rows (counted as due today) and the upcoming ones up to the horizon. */
  planned: PlannedRow[]
  names: Record<string, string>
  truncated: boolean
}

async function readSeriesNames(r: Reader, db: Firestore, orgId: string): Promise<Record<string, string>> {
  const snap = await r.query(recurringCol(db, orgId).select('name').limit(MAX_SERIES))
  const names: Record<string, string> = {}
  for (const d of snap.docs) {
    const name = d.get('name')
    if (typeof name === 'string') names[d.id] = name
  }
  return names
}

/** The forecast inputs of one snapshot: the company's accounts and minimum, the planned rows up to the horizon, the series names. */
async function readForecastInputs(r: Reader, deps: ReadDeps, orgId: string, today: string): Promise<ForecastInputs> {
  const { db } = deps
  const last = addDays(today, FORECAST_DAYS)
  const context = await readContext(r, db, orgId, false)
  const [overdue, upcoming, names] = await Promise.all([
    r.query(overdueQuery(db, orgId, today).orderBy('paymentDate').select(...ROW_FIELDS).limit(PLANNED_SCAN)),
    r.query(plannedBetween(db, orgId, today, last).select(...ROW_FIELDS).limit(PLANNED_SCAN)),
    readSeriesNames(r, db, orgId),
  ])
  const planned = [...overdue.docs, ...upcoming.docs].map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)
  return { today, context, planned, names, truncated: overdue.size >= PLANNED_SCAN || upcoming.size >= PLANNED_SCAN }
}

/** The forecast from its inputs, after the snapshot: the NBP rates (the latest table for each currency) and the balances. */
async function assemble(deps: ReadDeps, inputs: ForecastInputs): Promise<{ forecast: Forecast; rates: Map<string, number> }> {
  const { today, context } = inputs
  const base = context.baseCurrency
  const { book } = await quoteRates(deps.resolveRate, base, balanceRates(context.accounts, today, base))
  const rates = new Map<string, number>()
  for (const a of context.accounts) {
    const quote = book.get(rateKey(a.currency, valuationDate(today)))
    if (a.currency !== base && quote !== undefined) rates.set(a.currency, quote.rate)
  }
  const start = balancesReport({ date: today, baseCurrency: base, accounts: context.accounts, balances: new Map(), rates: book })
  const input: ForecastInput = {
    today,
    baseCurrency: base,
    minimumMinor: context.cashMinimumMinor,
    startBase: start.totalBase,
    startIncomplete: !start.complete,
    foreignAccounts: context.accounts.some((a) => a.currency !== base),
    planned: inputs.planned,
    rates,
    names: inputs.names,
    truncated: inputs.truncated,
  }
  return { forecast: buildForecast(input), rates }
}

/** `GET /forecast`: the 90-day balance forecast and the cash gap. */
export async function readForecast(deps: ReadDeps, orgId: string): Promise<Forecast> {
  const today = deps.today()
  const inputs = await readSnapshot(deps.db, (r) => readForecastInputs(r, deps, orgId, today))
  return (await assemble(deps, inputs)).forecast
}

/**
 * `GET /calendar?year&month`: a month of the payment calendar. What happened comes from the daily `cash_` rollups of every
 * account (income and expense counted in analytics); what is planned from the planned operations of the month; the balance
 * is the real total for the past days (`balancesAt`, valued at each day's NBP rate) and the forecast from today.
 */
export async function readCalendarMonth(deps: ReadDeps, orgId: string, year: number, month: number): Promise<CalendarMonth> {
  const { db } = deps
  const today = deps.today()
  const { first, last } = monthRange(year, month)
  const pastDays: string[] = []
  for (let d = first; d <= last && d < today; d = addDays(d, 1)) pastDays.push(d)

  // One snapshot: the forecast inputs and every month read, so the accounts and their balances agree with the rollups.
  const read = await readSnapshot(db, async (r) => {
    const inputs = await readForecastInputs(r, deps, orgId, today)
    const accountIds = new Set(inputs.context.accounts.map((a) => a.id))
    const docs: RollupDocs = new Map()
    if (first <= today) {
      for (const snap of await Promise.all([...accountIds].map((id) => r.query(cellsQuery(db, orgId, id, first, last, false))))) {
        for (const d of snap.docs) docs.set(d.id, flatten(d.data()))
      }
    }
    const facts = factsFromRollupDocs(selectRollupDocs(docs, accountIds, { from: first, to: last }, 'cashflow'))
    const movement = new Map<string, { incomeBase: number; expenseBase: number }>()
    for (const days of facts.cash.values()) {
      for (const [day, cell] of days) {
        const m = movement.get(day) ?? { incomeBase: 0, expenseBase: 0 }
        movement.set(day, { incomeBase: m.incomeBase + cell.inBase, expenseBase: m.expenseBase + cell.outBase })
      }
    }
    const plannedSnap = await r.query(plannedBetween(db, orgId, first, last).select(...ROW_FIELDS).limit(PLANNED_SCAN))
    const planned = plannedSnap.docs.map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)

    let balances = new Map<string, Map<string, number>>()
    if (pastDays.length > 0) {
      const counted = await countArrivals(r, deps, orgId, inputs.context.accounts, pastDays, today)
      if ([...counted.values()].reduce((a, b) => a + b, 0) > REPORT_SCAN_CAP) throw new ReportError('too_many_operations', { cap: REPORT_SCAN_CAP })
      const stats: BalanceReadStats = { docsRead: 0, aggregates: 0, ids: new Set(), counted }
      balances = await balancesAt(r, deps, orgId, inputs.context.accounts, pastDays, today, stats)
    }
    // The size before filtering: a row that does not parse still means the scan limit was reached.
    return { inputs, movement, planned, balances, truncated: plannedSnap.size >= PLANNED_SCAN }
  })

  const { context } = read.inputs
  const base = context.baseCurrency
  const { forecast, rates } = await assemble(deps, read.inputs)
  // The real total of each past day, valued at that day's NBP rate.
  const needs = pastDays.flatMap((day) => balanceRates(context.accounts, day, base))
  const { book } = await quoteRates(deps.resolveRate, base, needs)
  const pastBalances = new Map<string, number | null>()
  for (const day of pastDays) {
    const atDay = new Map(context.accounts.map((a) => [a.id, read.balances.get(a.id)?.get(day) ?? a.balanceMinor]))
    const report = balancesReport({ date: day, baseCurrency: base, accounts: context.accounts, balances: atDay, rates: book })
    pastBalances.set(day, report.complete ? report.totalBase : null)
  }
  const built = buildCalendarMonth({ year, month, today, currency: base, movement: read.movement, planned: read.planned, rates, pastBalances, forecast })
  return { ...built, truncated: built.truncated || read.truncated }
}

/** `GET /calendar/day?date`: the operations paid on a day, planned and actual, at most DAY_ROWS. */
export async function readCalendarDay(deps: ReadDeps, orgId: string, date: string): Promise<DayPayments> {
  const { db } = deps
  return readSnapshot(db, async (r) => {
    const [snap, names] = await Promise.all([
      r.query(transactionsCol(db, orgId).where('paymentDate', '==', date).limit(DAY_ROWS + 1)),
      readSeriesNames(r, db, orgId),
    ])
    const planned: PlannedRow[] = []
    const actual: DayActual[] = []
    for (const d of snap.docs.slice(0, DAY_ROWS)) {
      if (d.get('status') === 'planned') {
        const row = parsePlannedRow(d.id, d.data())
        if (row !== null) planned.push(row)
        continue
      }
      const tx = parseTransaction(d.id, d.data())
      if (tx !== null) actual.push({ id: tx.id, type: tx.type, accountId: tx.accountId, amountMinor: tx.amountMinor, currency: tx.currency, ...(tx.description !== undefined ? { description: tx.description } : {}) })
    }
    return { date, planned, actual, names, truncated: snap.size > DAY_ROWS }
  })
}
