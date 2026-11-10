import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { MAX_MATCH_ITEMS, type FutureMode, type MatchOutcome, type MatchSuggestions, type PlanMatch, type RecurringOverview, type Series } from '@/lib/domain/recurring/types'
import { apiCall, readApiError } from './ledger-client'
import { notifyLedgerChanged } from './ledger-events'

const EVENT = 'finflow:recurring-changed'
const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`
const one = (orgId: string, seriesId: string) => `${org(orgId)}/recurring/${encodeURIComponent(seriesId)}`

/** Tells the planned payments page and the journal's matches that series, plans or matches changed in this browser. */
export function notifyRecurringChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onRecurringChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

/** After a write: the journal reloads its rows, the page and the matches read again. */
function changed(): void {
  notifyLedgerChanged()
  notifyRecurringChanged()
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

/** The page «Планові платежі» (S11). Throws `LedgerApiError`. */
export function fetchRecurringOverview(orgId: string, signal?: AbortSignal): Promise<RecurringOverview> {
  return read<RecurringOverview>(`${org(orgId)}/recurring`, signal)
}

/** One series (the form names it); status 404 when it is gone. */
export async function fetchSeries(orgId: string, seriesId: string, signal?: AbortSignal): Promise<Series> {
  return (await read<{ series: Series }>(one(orgId, seriesId), signal)).series
}

/** The plan ↔ bank pairs the journal suggests. */
export function fetchPlanMatches(orgId: string, signal?: AbortSignal): Promise<MatchSuggestions> {
  return read<MatchSuggestions>(`${org(orgId)}/recurring/suggestions`, signal)
}

export async function createSeries(orgId: string, body: Record<string, unknown>): Promise<{ series: Series; created: number }> {
  try {
    return (await apiCall('POST', `${org(orgId)}/recurring`, body)) as { series: Series; created: number }
  } finally {
    changed()
  }
}

export interface SeriesUpdate {
  series: Series
  created: number
  updated: number
  deleted: number
}

export async function updateSeries(orgId: string, seriesId: string, patch: Record<string, unknown>): Promise<SeriesUpdate> {
  try {
    return (await apiCall('PATCH', one(orgId, seriesId), patch)) as SeriesUpdate
  } finally {
    changed()
  }
}

export async function deleteSeries(orgId: string, seriesId: string, future: FutureMode): Promise<{ deleted: number }> {
  try {
    return (await apiCall('DELETE', `${one(orgId, seriesId)}?future=${future}`)) as { deleted: number }
  } finally {
    changed()
  }
}

/** «Пропустити цей раз»: the plan as it was, for the undo (`restoreTransaction` under its plan id). */
export async function skipPlan(orgId: string, seriesId: string, occurrence: string): Promise<LedgerTransaction> {
  try {
    return ((await apiCall('POST', `${one(orgId, seriesId)}/skip`, { occurrence })) as { before: LedgerTransaction }).before
  } finally {
    changed()
  }
}

async function postMatches(orgId: string, body: unknown): Promise<MatchOutcome[]> {
  return ((await apiCall('POST', `${org(orgId)}/recurring/matches`, body)) as { results: MatchOutcome[] }).results
}

/** Confirms suggested pairs with the versions the person saw: a side changed since is a `conflict`, never linked blindly. */
export async function confirmMatches(orgId: string, pairs: readonly PlanMatch[]): Promise<MatchOutcome[]> {
  try {
    const out: MatchOutcome[] = []
    for (let i = 0; i < pairs.length; i += MAX_MATCH_ITEMS) {
      const chunk = pairs.slice(i, i + MAX_MATCH_ITEMS)
      out.push(...(await postMatches(orgId, { confirm: chunk.map((p) => ({ planId: p.plan.id, bankId: p.bank.id, versions: [p.plan.version, p.bank.version] })) })))
    }
    return out
  } finally {
    changed()
  }
}

/** The undo of confirmed pairs, by plan id (requests of at most MAX_MATCH_ITEMS). */
export async function undoMatches(orgId: string, planIds: readonly string[]): Promise<MatchOutcome[]> {
  try {
    const out: MatchOutcome[] = []
    for (let i = 0; i < planIds.length; i += MAX_MATCH_ITEMS) out.push(...(await postMatches(orgId, { undo: planIds.slice(i, i + MAX_MATCH_ITEMS) })))
    return out
  } finally {
    changed()
  }
}
