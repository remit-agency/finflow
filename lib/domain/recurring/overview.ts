import { addDays } from '@/lib/domain/ledger/days'
import { addMonthsClamped, nextOccurrenceAfter, paymentDayOf } from './schedule'
import {
  LIST_DAYS,
  LIST_ROWS,
  UPCOMING_DAYS,
  UPCOMING_PERIOD_MONTHS,
  type CurrencyTotal,
  type PlannedRow,
  type RecurringOverview,
  type Series,
  type SeriesRow,
  type UpcomingPeriod,
  type UpcomingRead,
} from './types'

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

/** The last day of a journal block period on `today` (included); null for «Усе». */
export function upcomingEnd(period: UpcomingPeriod, today: string): string | null {
  const months = UPCOMING_PERIOD_MONTHS[period]
  return months === null ? null : addMonthsClamped(today, months)
}

/** The journal's «Майбутні платежі» block (S12d, S12e): what is overdue and what falls in the chosen period. */
export interface UpcomingBlock {
  /** Overdue first (oldest first), then the upcoming ones by payment day. */
  rows: PlannedRow[]
  /** The title's number. */
  count: number
  /** `count` is the whole number; false when an account is chosen and the server listed only the first rows of a longer list. */
  exact: boolean
}

/**
 * The rows of the journal block from `GET /recurring/upcoming`. With an account chosen in the sidebar only that account's
 * operations count, as in the list below; the server counts every account, so then the number is that of the listed rows,
 * and it is not `exact` when the server listed fewer rows than it counted.
 */
export function upcomingBlock(read: Pick<UpcomingRead, 'overdue' | 'overdueCount' | 'upcoming' | 'upcomingCount'>, accountId?: string): UpcomingBlock {
  if (accountId === undefined) return { rows: [...read.overdue, ...read.upcoming], count: read.overdueCount + read.upcomingCount, exact: true }
  const rows = [...read.overdue, ...read.upcoming].filter((r) => r.accountId === accountId)
  return { rows, count: rows.length, exact: read.overdueCount <= read.overdue.length && read.upcomingCount <= read.upcoming.length }
}
