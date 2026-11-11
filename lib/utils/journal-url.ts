import { EMPTY_FILTERS, filtersToParams, hasActiveFilters, parseFilters, type JournalFilters } from '@/lib/domain/journal/filter'
import { fromDay, toDay } from '@/lib/domain/ledger/days'
import type { TxStatus } from '@/lib/domain/ledger/types'
import { resolvePeriod, type PeriodPreset, type PeriodSelection } from '@/lib/utils/period'

/** The journal's period menu: all time first (Finmap's default), the reports' presets after it. */
export const JOURNAL_PERIOD_PRESETS: readonly PeriodPreset[] = [
  'allTime',
  'currentMonth',
  'prevMonth',
  'currentWeek',
  'prevWeek',
  'currentYear',
  'prevYear',
  'custom',
]
export const DEFAULT_JOURNAL_PERIOD: PeriodSelection = { preset: 'allTime' }

/**
 * The journal's default view (S12d): what happened. The planned payments are the «Майбутні платежі» block above the list;
 * «План» and «Всі» in the status filter bring them into the list. The domain's `status: undefined` stays «every status».
 */
export const DEFAULT_JOURNAL_FILTERS: JournalFilters = { ...EMPTY_FILTERS, status: 'actual' }

/** The status of an address: «Факт» when it says nothing (or something unknown), `all` for every status. */
function statusFromParams(params: URLSearchParams): TxStatus | undefined {
  const raw = params.get('status')
  return raw === 'all' ? undefined : raw === 'planned' ? 'planned' : 'actual'
}

/** True when the view narrows the list beyond the default: the status «Факт» alone is the default, not a filter. */
export function journalFiltersActive(f: JournalFilters): boolean {
  return hasActiveFilters({ ...f, status: undefined }) || f.status !== 'actual'
}

export interface JournalView {
  filters: JournalFilters
  period: PeriodSelection
}

function daysOf(period: PeriodSelection, now: Date): { from?: string; to?: string } {
  const range = resolvePeriod(period, now)
  return { ...(range.start ? { from: toDay(range.start) } : {}), ...(range.end ? { to: toDay(range.end) } : {}) }
}

/**
 * The journal view from the address. A preset is stored by name and resolved against today, so a saved link
 * to «this month» stays this month; a custom range stores its two days. The account is the shell's selection
 * and never comes from the address.
 */
export function viewFromParams(params: URLSearchParams, now: Date): JournalView {
  const parsed = parseFilters(params)
  const { accountId: _account, from, to, ...restParsed } = parsed
  void _account
  const rest = { ...restParsed, status: statusFromParams(params) }
  const preset = params.get('period') as PeriodPreset | null

  if (preset === 'custom' && from && to) {
    return { filters: { ...rest, from, to }, period: { preset: 'custom', start: fromDay(from), end: fromDay(to) } }
  }
  if (preset && preset !== 'custom' && preset !== 'allTime' && JOURNAL_PERIOD_PRESETS.includes(preset)) {
    const period: PeriodSelection = { preset }
    return { filters: { ...rest, ...daysOf(period, now) }, period }
  }
  return { filters: { ...EMPTY_FILTERS, ...rest }, period: DEFAULT_JOURNAL_PERIOD }
}

/**
 * The two days of a custom period, earliest first: the period menu hands over `start` and `end` (any time of the
 * day, in either order), and the address stores days.
 */
function customDays(period: PeriodSelection): { from: string; to: string } | null {
  if (period.preset !== 'custom' || !period.start || !period.end) return null
  const a = toDay(period.start)
  const b = toDay(period.end)
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

export function viewToParams(view: JournalView): URLSearchParams {
  const { accountId: _account, from, to, status, ...rest } = view.filters
  void _account
  const custom = view.period.preset === 'custom'
  const picked = customDays(view.period)
  const range = picked ?? { from, to }
  // «Факт» is the default and is not written; «План» is; every status is `status=all`.
  const params = filtersToParams({ ...rest, ...(status === 'planned' ? { status } : {}), ...(custom ? range : {}) })
  if (status === undefined) params.set('status', 'all')
  if (view.period.preset !== 'allTime') params.set('period', view.period.preset)
  return params
}
