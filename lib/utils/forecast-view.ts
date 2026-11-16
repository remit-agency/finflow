import type { CalendarMonth } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'

/**
 * The display rules of the payment calendar (S13), pure: the grid and the chart read the same figures.
 * Amounts here are major units (`fromMinor` of the minor units); the exact figures are in the day panel.
 */

/**
 * An amount in whole units, half away from zero (the Intl rounding). `-0` is `0`, so an amount that rounds to zero
 * never prints as "-0"; callers hide a zero amount instead of showing it.
 */
export function wholeUnits(major: number): number {
  const rounded = Math.sign(major) * Math.round(Math.abs(major))
  return rounded === 0 ? 0 : rounded
}

/** The day of the month («24») of the cash gap day when that day is in this month; null when the gap is in another month or there is none. */
export function gapDayLabel(month: CalendarMonth): string | null {
  const gap = month.days.find((d) => d.gap)
  return gap === undefined ? null : String(Number(gap.date.slice(8)))
}

/** One point of the chart: the day of the month and its balance in major units. */
export interface ChartPoint {
  /** The day of the month («5»): the category of the x axis. */
  label: string
  /** Actual end balance of a past day, in the company currency. */
  actual: number | null
  /** Forecast end balance from today on; the last past day repeats its value so the two lines join. */
  forecast: number | null
}

/** One point per day of the month. */
export function chartPoints(month: CalendarMonth): ChartPoint[] {
  return month.days.map((d, i) => {
    const value = d.endBalanceBase === null ? null : fromMinor(d.endBalanceBase)
    const isLastPast = d.kind === 'past' && month.days[i + 1]?.kind === 'today'
    return {
      label: String(Number(d.date.slice(8))),
      actual: d.kind === 'past' ? value : null,
      forecast: d.kind !== 'past' || isLastPast ? value : null,
    }
  })
}
