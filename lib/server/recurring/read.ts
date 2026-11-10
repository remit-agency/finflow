import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { addDays } from '@/lib/domain/ledger/days'
import { parseSeries } from '@/lib/domain/recurring/doc'
import { BANK_FIELDS, findPlanMatches, parseBankSide, parsePlanSide } from '@/lib/domain/recurring/match'
import { buildOverview } from '@/lib/domain/recurring/overview'
import { ROW_FIELDS, parsePlannedRow } from '@/lib/domain/recurring/rows'
import { windowEnd } from '@/lib/domain/recurring/schedule'
import {
  LIST_ROWS,
  MATCH_AFTER_DAYS,
  MATCH_BANK_SCAN,
  MATCH_BEFORE_DAYS,
  MATCH_LOOKBACK_DAYS,
  MATCH_PLAN_SCAN,
  MAX_SERIES,
  PLANNED_SCAN,
  type BankSide,
  type MatchSuggestions,
  type PlanMatch,
  type PlanSide,
  type PlannedRow,
  type RecurringOverview,
  type Series,
} from '@/lib/domain/recurring/types'
import { encodeVersion } from '@/lib/domain/transfers/version'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { recurringCol, transactionsCol } from '@/lib/server/ledger/paths'

type ReadDeps = Pick<LedgerDeps, 'db' | 'today'>

function nonNull<T>(v: T | null): v is T {
  return v !== null
}

/** Planned operations before today (index `transactions (status ASC, paymentDate ASC)`). */
export function overdueQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '<', today)
}

/** Planned operations from today to the window end, by payment day (the same index). */
export function upcomingQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '>=', today).where('paymentDate', '<=', windowEnd(today)).orderBy('paymentDate')
}

/** The plans a bank operation may have paid: from MATCH_LOOKBACK_DAYS back to MATCH_BEFORE_DAYS ahead (the same index). */
export function planCandidatesQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId)
    .where('status', '==', 'planned')
    .where('paymentDate', '>=', addDays(today, -MATCH_LOOKBACK_DAYS))
    .where('paymentDate', '<=', addDays(today, MATCH_BEFORE_DAYS))
    .orderBy('paymentDate')
}

/** The series whose daily fill is due, longest waiting first (index `fieldOverrides recurring.dueOn COLLECTION_GROUP`). */
export function dueSeriesQuery(db: Firestore, today: string): Query {
  return db.collectionGroup('recurring').where('dueOn', '<=', today).orderBy('dueOn')
}

export async function readSeries(deps: Pick<LedgerDeps, 'db'>, orgId: string, seriesId: string): Promise<Series | null> {
  const snap = await recurringCol(deps.db, orgId).doc(seriesId).get()
  return snap.exists ? parseSeries(snap.id, snap.data()) : null
}

function rowsOf(docs: readonly QueryDocumentSnapshot[]): PlannedRow[] {
  return docs.map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)
}

/**
 * `GET /recurring` (S11), computed on demand: the series (at most MAX_SERIES), the number of overdue planned operations (one
 * `count()`), the oldest LIST_ROWS of them, and the planned operations from today to the window end (at most PLANNED_SCAN,
 * selected fields). Nothing is stored.
 */
export async function readOverview(deps: ReadDeps, orgId: string): Promise<RecurringOverview> {
  const { db } = deps
  const today = deps.today()
  const [seriesSnap, countSnap, overdueSnap, upcomingSnap] = await Promise.all([
    recurringCol(db, orgId).limit(MAX_SERIES).get(),
    overdueQuery(db, orgId, today).count().get(),
    overdueQuery(db, orgId, today).orderBy('paymentDate').select(...ROW_FIELDS).limit(LIST_ROWS).get(),
    upcomingQuery(db, orgId, today).select(...ROW_FIELDS).limit(PLANNED_SCAN).get(),
  ])
  return buildOverview({
    series: seriesSnap.docs.map((d) => parseSeries(d.id, d.data())).filter(nonNull),
    overdue: rowsOf(overdueSnap.docs),
    overdueCount: countSnap.data().count,
    upcoming: rowsOf(upcomingSnap.docs),
    truncated: upcomingSnap.size >= PLANNED_SCAN,
    today,
  })
}

export interface MatchRead extends MatchSuggestions {
  plansRead: number
  banksRead: number
}

/** The names of the series of the pairs (one `getAll`, at most MAX_MATCHES documents). */
async function withNames(db: Firestore, orgId: string, pairs: PlanMatch[]): Promise<PlanMatch[]> {
  const ids = [...new Set(pairs.map((p) => p.plan.seriesId))]
  if (ids.length === 0) return pairs
  const snaps = await db.getAll(...ids.map((id) => recurringCol(db, orgId).doc(id)))
  const names = new Map<string, unknown>(snaps.filter((s) => s.exists).map((s) => [s.id, s.get('name')]))
  return pairs.map((p) => {
    const name = names.get(p.plan.seriesId)
    return typeof name === 'string' ? { ...p, plan: { ...p.plan, name } } : p
  })
}

/**
 * The plan ↔ bank pairs the journal suggests (S11), computed on demand. First the plans that a bank operation could have
 * paid (at most MATCH_PLAN_SCAN); only when there are some, the operations of the days they span (from the first plan's
 * day − MATCH_BEFORE_DAYS to the last plan's day + MATCH_AFTER_DAYS, never after today; at most MATCH_BANK_SCAN, the
 * query shape of the S10b suggestions, no new index), filtered to unlinked bank operations in memory. Each side carries its
 * document version, which a confirmation sends back.
 */
export async function readMatchSuggestions(deps: ReadDeps, orgId: string): Promise<MatchRead> {
  const { db } = deps
  const today = deps.today()
  const planSnap = await planCandidatesQuery(db, orgId, today).select(...ROW_FIELDS).limit(MATCH_PLAN_SCAN).get()
  const plans: PlanSide[] = planSnap.docs.map((d) => parsePlanSide(d.id, d.data(), encodeVersion(d.updateTime))).filter(nonNull)
  const plansCut = planSnap.size >= MATCH_PLAN_SCAN
  if (plans.length === 0) return { pairs: [], total: 0, ambiguous: 0, truncated: plansCut, plansRead: planSnap.size, banksRead: 0 }
  const from = addDays(plans[0].paymentDate, -MATCH_BEFORE_DAYS)
  const last = addDays(plans[plans.length - 1].paymentDate, MATCH_AFTER_DAYS)
  const to = last < today ? last : today
  const bankSnap =
    from > to
      ? null
      : await transactionsCol(db, orgId).where('paymentDate', '>=', from).where('paymentDate', '<=', to).orderBy('paymentDate', 'desc').select(...BANK_FIELDS).limit(MATCH_BANK_SCAN).get()
  const banks: BankSide[] = (bankSnap?.docs ?? []).map((d) => parseBankSide(d.id, d.data(), encodeVersion(d.updateTime))).filter(nonNull)
  const found = findPlanMatches(plans, banks)
  return {
    pairs: await withNames(db, orgId, found.pairs),
    total: found.total,
    ambiguous: found.ambiguous,
    truncated: plansCut || (bankSnap?.size ?? 0) >= MATCH_BANK_SCAN,
    plansRead: planSnap.size,
    banksRead: bankSnap?.size ?? 0,
  }
}
