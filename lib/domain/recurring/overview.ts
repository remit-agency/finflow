import { addDays } from '@/lib/domain/ledger/days'
import { nextOccurrenceAfter, paymentDayOf } from './schedule'
import { LIST_DAYS, LIST_ROWS, UPCOMING_DAYS, type CurrencyTotal, type PlannedRow, type RecurringOverview, type Series, type SeriesRow } from './types'

export interface OverviewInput {
  series: readonly Series[]
  /** The oldest overdue planned operations (the read takes LIST_ROWS). */
  overdue: readonly PlannedRow[]
  overdueCount: number
  /** The planned operations from today to the window end, by payment day. */
  upcoming: readonly PlannedRow[]
  truncated: boolean
  today: string
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function totals(m: ReadonlyMap<string, number>): CurrencyTotal[] {
  return [...m].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => byText(a.currency, b.currency))
}

/** The next payment day of a series: its first plan from today, else the first occurrence after the filled window; none when paused or ended. */
function nextOf(s: Series, firstPlan: string | undefined, today: string): string | null {
  if (s.status !== 'active') return null
  if (firstPlan !== undefined) return firstPlan
  const after = nextOccurrenceAfter(s, s.generatedThrough ?? addDays(today, -1))
  return after === null ? null : paymentDayOf(after, s.weekendRule)
}

/**
 * `GET /recurring` from what it read (S11): «Прострочено» (count and the oldest rows), the planned operations of the next
 * LIST_DAYS, «Найближчі 7 днів» per kind and currency (transfers move no money out of the company and are left out), and
 * each series with its next payment day (active first by that day, then by name).
 */
export function buildOverview(input: OverviewInput): RecurringOverview {
  const { today } = input
  const soonEnd = addDays(today, UPCOMING_DAYS - 1)
  const listEnd = addDays(today, LIST_DAYS - 1)
  const income = new Map<string, number>()
  const expense = new Map<string, number>()
  const firstPlan = new Map<string, string>()
  for (const row of input.upcoming) {
    if (row.seriesId !== undefined && !firstPlan.has(row.seriesId)) firstPlan.set(row.seriesId, row.paymentDate)
    if (row.paymentDate > soonEnd || row.type === 'transfer') continue
    const sums = row.type === 'income' ? income : expense
    sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.amountMinor)
  }
  const series = input.series.map((s): SeriesRow => ({ ...s, next: nextOf(s, firstPlan.get(s.id), today) }))
  series.sort((a, b) => {
    if (a.next !== b.next) {
      if (a.next === null) return 1
      if (b.next === null) return -1
      return byText(a.next, b.next)
    }
    return byText(a.name, b.name) || byText(a.id, b.id)
  })
  return {
    series,
    overdueCount: input.overdueCount,
    overdue: input.overdue.slice(0, LIST_ROWS),
    upcoming: input.upcoming.filter((r) => r.paymentDate <= listEnd).slice(0, LIST_ROWS),
    soon: { income: totals(income), expense: totals(expense) },
    truncated: input.truncated,
  }
}

/** The journal's «Майбутні платежі» block (S12d): what is overdue and what falls in the next UPCOMING_DAYS days. */
export interface UpcomingBlock {
  /** Overdue first (oldest first), then the next days. */
  rows: PlannedRow[]
  /** The title's number: every overdue operation (the overview lists at most LIST_ROWS of them) and the next days. */
  count: number
}

/**
 * The rows of the journal block from the overview. With an account selected in the sidebar only that account's operations
 * count, as in the list below. An overdue total the overview did not list in full still counts in full without an account.
 */
export function upcomingBlock(overview: Pick<RecurringOverview, 'overdue' | 'overdueCount' | 'upcoming'>, today: string, accountId?: string): UpcomingBlock {
  const end = addDays(today, UPCOMING_DAYS - 1)
  const keep = (r: PlannedRow): boolean => accountId === undefined || r.accountId === accountId
  const overdue = overview.overdue.filter(keep)
  const soon = overview.upcoming.filter((r) => r.paymentDate <= end && keep(r))
  const overdueTotal = accountId === undefined ? Math.max(overview.overdueCount, overdue.length) : overdue.length
  return { rows: [...overdue, ...soon], count: overdueTotal + soon.length }
}
