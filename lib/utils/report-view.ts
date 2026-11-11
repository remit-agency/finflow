// lib/utils/report-view.ts
// The server reports (S12) as the pages and the export show them: labels of the period keys and, from Task 11, the view
// models of the pages. Intl formatting stays in lib/utils and lib/i18n.
import type { Locale } from '@/lib/i18n/config'
import { formatDayLabel, formatMonthLabel } from './analytics'

/** A day (`YYYY-MM-DD`) or a month (`YYYY-MM`) of a report as its label in the UI language («19 жов», «Жов 26»). */
export function periodKeyLabel(key: string, locale: Locale): string {
  const [year, month, day] = key.split('-').map(Number)
  return day === undefined ? formatMonthLabel(year, month - 1, locale) : formatDayLabel(new Date(Date.UTC(year, month - 1, day)), locale)
}
