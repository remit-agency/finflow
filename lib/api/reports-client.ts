// lib/api/reports-client.ts
// The browser side of the server reports (S12): same-origin GETs that authenticate with the session cookie, and the export,
// which the server builds and the browser only names and saves.
import { ReportError, type PeriodProblem } from '@/lib/domain/reports/errors'
import { reportQueryToParams } from '@/lib/domain/reports/query'
import type { BalancesReport, CashFlowReport, DashboardReport, ExportFormat, PLReport, ReportKind, ReportQuery } from '@/lib/domain/reports/types'
import { downloadBlob } from '@/lib/utils/download'
import { LedgerApiError, readApiError } from './ledger-client'

/**
 * What a page shows of one server read. `invalid`: the address the page built is refused before any request; `reason` says why.
 * `busy`: the server refused for too many requests of this user (a moment later, not a broken report).
 */
export type ServerView<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'too_large'; cap: number }
  | { status: 'invalid'; reason: PeriodProblem }
  | { status: 'busy' }
  | { status: 'error' }

const reportsPath = (orgId: string): string => `/api/orgs/${encodeURIComponent(orgId)}/reports`

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

export function fetchCashFlow(orgId: string, query: ReportQuery, signal?: AbortSignal): Promise<CashFlowReport> {
  return getJson(`${reportsPath(orgId)}/cashflow?${reportQueryToParams(query)}`, signal)
}

export function fetchPL(orgId: string, query: ReportQuery, signal?: AbortSignal): Promise<PLReport> {
  return getJson(`${reportsPath(orgId)}/pl?${reportQueryToParams(query)}`, signal)
}

export function fetchBalances(orgId: string, date: string, signal?: AbortSignal): Promise<BalancesReport> {
  return getJson(`${reportsPath(orgId)}/balances?${new URLSearchParams({ date })}`, signal)
}

export function fetchDashboard(orgId: string, signal?: AbortSignal): Promise<DashboardReport> {
  return getJson(`${reportsPath(orgId)}/dashboard`, signal)
}

/** The file is built by the server from the same report the page shows; `filename` is the page's (it knows the period's name). */
export async function downloadReport(orgId: string, kind: ReportKind, format: ExportFormat, query: ReportQuery, filename: string): Promise<void> {
  const params = new URLSearchParams({ report: kind, format })
  for (const [key, value] of reportQueryToParams(query)) params.set(key, value)
  const res = await fetch(`${reportsPath(orgId)}/export?${params}`, { credentials: 'same-origin' })
  if (!res.ok) throw await readApiError(res)
  downloadBlob(filename, await res.blob())
}

/**
 * A report that needs more documents than the server reads at once is a state of its own («звузьте період»); anything else is an
 * error. (The NBP rates never refuse a report: the reconciliation names the ones it left out.)
 */
export function viewOfFailure(e: unknown): ServerView<never> {
  if (e instanceof LedgerApiError && e.status === 422 && e.code === 'too_many_operations') {
    const cap = Number(e.details?.cap)
    return { status: 'too_large', cap: Number.isFinite(cap) ? cap : 0 }
  }
  if (e instanceof ReportError && e.code === 'invalid_input' && e.reason !== undefined) return { status: 'invalid', reason: e.reason }
  if (e instanceof LedgerApiError && e.status === 429) return { status: 'busy' }
  return { status: 'error' }
}
