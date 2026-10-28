import { EMPTY_FILTERS, filtersToParams, parseFilters, type JournalFilters } from '@/lib/domain/journal/filter'
import { fromDay, toDay } from '@/lib/domain/ledger/days'
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
  const { accountId: _account, from, to, ...rest } = parsed
  void _account
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
  const { accountId: _account, from, to, ...rest } = view.filters
  void _account
  const custom = view.period.preset === 'custom'
  const picked = customDays(view.period)
  const range = picked ?? { from, to }
  const params = filtersToParams({ ...rest, ...(custom ? range : {}) })
  if (view.period.preset !== 'allTime') params.set('period', view.period.preset)
  return params
}
