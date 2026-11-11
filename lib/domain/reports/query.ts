// lib/domain/reports/query.ts
// The address of a report (S12): the period and the S10f filters under the journal's names. The browser writes it with
// `reportQueryToParams`; the server reads it strictly (`parseReportQuery`): what the lenient S10f reader would drop is a 400.
import { activeAnalyticsFilterCount, analyticsFiltersToParams, parseAnalyticsFilters, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { daysInRange, isDay, monthBounds, monthOf } from '@/lib/domain/ledger/days'
import { ReportError } from './errors'
import { EXPORT_FORMATS, MAX_REPORT_DAYS, REPORT_KINDS, type ExportFormat, type ReportKind, type ReportQuery, type ReportSource } from './types'

const FILTER_PARAMS = ['types', 'cat', 'cp', 'tg', 'accounts'] as const
const QUERY_PARAMS: readonly string[] = ['from', 'to', ...FILTER_PARAMS]

function bad(field: string): never {
  throw new ReportError('invalid_input', { field })
}

function single(p: URLSearchParams, key: string): string | null {
  const all = p.getAll(key)
  if (all.length > 1) bad(key)
  return all[0] ?? null
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value)
}

/** The period and the filters; `extra` names the other parameters a route reads itself (the export's report and format). */
export function parseReportQuery(p: URLSearchParams, extra: readonly string[] = []): ReportQuery {
  for (const key of p.keys()) if (!QUERY_PARAMS.includes(key) && !extra.includes(key)) bad(key)
  const from = single(p, 'from')
  const to = single(p, 'to')
  if (!isDay(from)) bad('from')
  if (!isDay(to)) bad('to')
  if (to < from) throw new ReportError('invalid_input', { field: 'to', reason: 'order' })
  if (daysInRange(from, to) > MAX_REPORT_DAYS) throw new ReportError('invalid_input', { field: 'to', reason: 'too_long' })
  for (const key of FILTER_PARAMS) single(p, key)
  const filters = parseAnalyticsFilters(p)
  const kept: Record<(typeof FILTER_PARAMS)[number], number> = {
    types: filters.types.length,
    cat: filters.categoryIds.length,
    cp: filters.counterpartyIds.length,
    tg: filters.tagIds.length,
    accounts: filters.accountIds.length,
  }
  for (const key of FILTER_PARAMS) {
    const raw = p.get(key)
    const given = raw === null || raw === '' ? 0 : raw.split(',').length
    if (given !== kept[key]) bad(key)
  }
  return { from, to, filters }
}

export function reportQueryToParams(q: ReportQuery): URLSearchParams {
  const out = new URLSearchParams({ from: q.from, to: q.to })
  for (const [key, value] of analyticsFiltersToParams(q.filters)) out.set(key, value)
  return out
}

/** The period starts on the 1st of its month and ends on the last day of its month. */
export function isWholeMonths(from: string, to: string): boolean {
  return from.endsWith('-01') && monthBounds(monthOf(to)).last === to
}

/**
 * A filter other than the accounts (a type, a category, a counterparty or a tag): the figures are then a part of the accounts'
 * movement, so a row shows its movement without its balances (the rows of Cash Flow close only on the whole movement).
 */
export function hasNonAccountFilters(f: AnalyticsFilters): boolean {
  return f.types.length > 0 || f.categoryIds.length > 0 || f.counterpartyIds.length > 0 || f.tagIds.length > 0
}

/** The rollups hold no counterparty, tag or account breakdown of the categories and no part of a month. */
export function reportSource(q: ReportQuery): ReportSource {
  return activeAnalyticsFilterCount(q.filters, 'operations') === 0 && isWholeMonths(q.from, q.to) ? 'rollups' : 'operations'
}

/** `?date=YYYY-MM-DD` of the balances, nothing else. */
export function parseBalancesDate(p: URLSearchParams): string {
  for (const key of p.keys()) if (key !== 'date') bad(key)
  const date = single(p, 'date')
  if (!isDay(date)) bad('date')
  return date
}

export function parseExportRequest(p: URLSearchParams): { kind: ReportKind; format: ExportFormat; query: ReportQuery } {
  const kind = single(p, 'report')
  const format = single(p, 'format')
  if (!isOneOf(REPORT_KINDS, kind)) bad('report')
  if (!isOneOf(EXPORT_FORMATS, format)) bad('format')
  return { kind, format, query: parseReportQuery(p, ['report', 'format']) }
}
