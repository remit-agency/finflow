// lib/server/reports/read.ts
// The server reports (S12). All the reads of one request are one read-only snapshot (`readSnapshot`), then the pure
// builders of lib/domain/reports. Without filters over whole months the figures come from the rollups (the daily
// documents of the period's accounts and two documents a month); otherwise from the operations of the period. Either way
// the queries are counted first in the same snapshot: more than the cap is a refusal before any document is read.
import { FieldPath, type Firestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { filterForAnalytics, includesExcluded } from '@/lib/domain/analytics-filter/filter'
import { categoryTypesOf, type CategoryTypes } from '@/lib/domain/analytics-filter/kinds'
import { matchesSharedChoices } from '@/lib/domain/journal/filter'
import { addDays, isDay, monthsBetween } from '@/lib/domain/ledger/days'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { MAX_PERIOD_MONTHS } from '@/lib/domain/ledger/input'
import { addInto, cashCatDocId, cashDocId, excludedDocId, flatten, plDocId, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { MAX_ARRIVAL_DAYS, type LedgerAccount, type LedgerTransaction } from '@/lib/domain/ledger/types'
import { buildCashFlowCore } from '@/lib/domain/reports/cashflow'
import { parseReportCategory, type ReportCategory } from '@/lib/domain/reports/categories'
import { ReportError } from '@/lib/domain/reports/errors'
import { factsFromRollupDocs, operationRollups, reachesPeriod, selectRollupDocs, type DayRange } from '@/lib/domain/reports/facts'
import { buildPLCore } from '@/lib/domain/reports/pl'
import { hasNonAccountFilters, reportSource } from '@/lib/domain/reports/query'
import { ratesForReconciliation, reconcile, reconciliationDays, type ReconcileAccount } from '@/lib/domain/reports/reconcile'
import {
  REPORT_SCAN_CAP,
  type CashFlowReport,
  type Coverage,
  type PLReport,
  type Reconciliation,
  type ReportFacts,
  type ReportKind,
  type ReportQuery,
  type ReportSource,
} from '@/lib/domain/reports/types'
import { balancesAt, countArrivals, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, categoriesCol, orgRef, rollupsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readSnapshot, type Reader } from '@/lib/server/ledger/reader'
import { quoteRates } from './rates'

/** The fields a report reads of an operation: what `parseTransaction` checks and what `contributions` and the filters use. */
export const REPORT_FIELDS = [
  'schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'accrual', 'isRecurring', 'tags', 'fileUrls',
  'toAccountId', 'toAmountMinor', 'toCurrency', 'toDate', 'categoryId', 'counterpartyId', 'base', 'excluded',
] as const

/**
 * What one request read. `operations` and `rollups` are the distinct documents the answer was built from (an operation that
 * two queries return is one); `reads` is every document read, duplicates included: the cost the cap limits.
 */
export interface ReportReadStats {
  operations: number
  rollups: number
  aggregates: number
  reads: number
}

/** The longest accrual period in days, both ends counted: a period has at most MAX_PERIOD_MONTHS months (S05 input rule). */
const MAX_PERIOD_DAYS = MAX_PERIOD_MONTHS * 31

export interface ReportContext {
  baseCurrency: string
  accounts: LedgerAccount[]
  categories: ReportCategory[]
  categoryTypes: CategoryTypes
}

/** The kinds of read a report makes: one document query, one aggregate (count) query, or documents by id. */
export type ReadKind = 'query' | 'aggregate' | 'getAll'

export interface ReadReportOptions {
  /** Tests and the rollout check: another read limit, or one path forced. */
  cap?: number
  /** Tests: another bound on the NBP month tables of the reconciliation (MAX_RATE_MONTHS by default). */
  rateMonths?: number
  source?: ReportSource
  /** Tests: told of every read before it is made (a refusal must make no document read). */
  onRead?: (kind: ReadKind) => void
}

function observed(r: Reader, onRead: ((kind: ReadKind) => void) | undefined): Reader {
  if (onRead === undefined) return r
  return {
    query(q) {
      onRead('query')
      return r.query(q)
    },
    aggregate(q) {
      onRead('aggregate')
      return r.aggregate(q)
    },
    getAll(refs) {
      onRead('getAll')
      return r.getAll(refs)
    },
  }
}

export interface ReportRead<T> {
  report: T
  stats: ReportReadStats
  /** The company's accounts and categories the report was built with (names for the export). */
  context: ReportContext
}

/** Operations paid in [from, to] (index `transactions (status ASC, paymentDate ASC)`, S11). */
export function paymentsQuery(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'actual').where('paymentDate', '>=', from).where('paymentDate', '<=', to)
}

/** Operations whose accrual day is in [from, to] (the automatic single-field index of `accrual.date`; planned ones too). */
export function accrualDaysQuery(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('accrual.date', '>=', from).where('accrual.date', '<=', to)
}

/**
 * The two single-field shapes of the operations whose accrual period overlaps the report (no composite index). A period of at
 * most MAX_PERIOD_MONTHS overlaps [from, to] only if it starts in `[from - MAX_PERIOD_DAYS, to]` and only if it ends in
 * `[from, to + MAX_PERIOD_DAYS]`, so either shape finds every overlapping period and the overlap is checked in memory. Which
 * one reads less depends on the history (periods that ended before the report, or that start after it), so both are counted
 * in the pre-count and the cheaper one is read (`choosePeriodShape`).
 */
export function accrualStartsQuery(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('accrual.from', '>=', addDays(from, -MAX_PERIOD_DAYS)).where('accrual.from', '<=', to)
}

export function accrualEndsQuery(db: Firestore, orgId: string, from: string, to: string): Query {
  return transactionsCol(db, orgId).where('accrual.to', '>=', from).where('accrual.to', '<=', addDays(to, MAX_PERIOD_DAYS))
}

/** One account's daily rollups of [from, to], or their `x_` twins, by document id (the built-in `__name__` index). */
export function cellsQuery(db: Firestore, orgId: string, accountId: string, from: string, to: string, excluded: boolean): Query {
  const col = rollupsCol(db, orgId)
  const id = (day: string): string => (excluded ? excludedDocId(cashDocId(accountId, day)) : cashDocId(accountId, day))
  return col.where(FieldPath.documentId(), '>=', col.doc(id(from))).where(FieldPath.documentId(), '<=', col.doc(id(to)))
}

/** The company currency, its accounts (schema 2) and, unless `withCategories` is false, its categories. */
export async function readContext(r: Reader, db: Firestore, orgId: string, withCategories = true): Promise<ReportContext> {
  const [org] = await r.getAll([orgRef(db, orgId)])
  if (!org?.exists) throw new LedgerError('not_found', 'org')
  const [accountsSnap, categoriesSnap] = await Promise.all([r.query(accountsCol(db, orgId)), withCategories ? r.query(categoriesCol(db, orgId)) : Promise.resolve(null)])
  const accounts = accountsSnap.docs.map((d) => parseAccount(d.id, d.data())).filter((a): a is LedgerAccount => a !== null)
  const categories = (categoriesSnap?.docs ?? []).map((d) => parseReportCategory(d.id, d.data())).filter((c): c is ReportCategory => c !== null)
  return { baseCurrency: org.get('currency') as string, accounts, categories, categoryTypes: categoryTypesOf(categories) }
}

/** One document query of a read plan, with the projection it reads (`fields`, all fields when absent). */
interface PlannedQuery {
  query: Query
  fields?: readonly string[]
}

/**
 * The count of each query, in the request's snapshot: aggregate reads, no document. The reads that follow return what was
 * counted, so completeness comes from what was examined, never from a hope.
 */
async function countQueries(r: Reader, queries: readonly Query[], stats: ReportReadStats): Promise<number[]> {
  const counts = await Promise.all(queries.map(async (q) => (await r.aggregate(q.count())).data().count))
  stats.aggregates += queries.length
  return counts
}

/** Refuses a request whose reads, as counted, pass the cap: before any document is read. */
function assertWithinCap(reads: number, cap: number): void {
  if (reads > cap) throw new ReportError('too_many_operations', { cap })
}

/** Reads what `countPlan` counted: each query with its counted limit, so no document beyond the count is read. */
async function readPlan(r: Reader, plan: readonly PlannedQuery[], counts: readonly number[]): Promise<QueryDocumentSnapshot[][]> {
  return Promise.all(
    plan.map(async (p, i) => (counts[i] === 0 ? [] : (await r.query((p.fields ? p.query.select(...p.fields) : p.query).limit(counts[i]))).docs)),
  )
}

/** The operations of some documents read, and the documents that do not parse (their ids go to `seen` for the coverage). */
function parseOps(docs: readonly QueryDocumentSnapshot[], seen: Set<string>): { ops: LedgerTransaction[]; malformed: QueryDocumentSnapshot[] } {
  const ops: LedgerTransaction[] = []
  const malformed: QueryDocumentSnapshot[] = []
  for (const d of docs) {
    seen.add(d.id)
    const tx = parseTransaction(d.id, d.data())
    if (tx) ops.push(tx)
    else malformed.push(d)
  }
  return { ops, malformed }
}

/**
 * A malformed payment cannot be placed by its parsed fields: its raw payment day and type decide whether it can change the
 * report (`reachesPeriod`); without a day it is counted, never assumed away.
 */
function malformedPaymentReaches(data: Record<string, unknown>, range: DayRange): boolean {
  const day = data.paymentDate
  return typeof day === 'string' && isDay(day) ? reachesPeriod(day, String(data.type), range) : true
}

/** The same for a malformed accrual period: its raw days decide whether it overlaps the period; without them it is counted. */
function malformedPeriodReaches(data: Record<string, unknown>, range: DayRange): boolean {
  const accrual = data.accrual
  if (typeof accrual !== 'object' || accrual === null) return true
  const { from, to } = accrual as Record<string, unknown>
  return typeof from === 'string' && isDay(from) && typeof to === 'string' && isDay(to) ? from <= range.to && to >= range.from : true
}

async function readRollups(r: Reader, db: Firestore, orgId: string, accountIds: readonly string[], range: DayRange, kind: ReportKind, cap: number, stats: ReportReadStats, arrivalReads: number): Promise<RollupDocs> {
  const plan: PlannedQuery[] = accountIds.flatMap((id) => [{ query: cellsQuery(db, orgId, id, range.from, range.to, false) }, { query: cellsQuery(db, orgId, id, range.from, range.to, true) }])
  const ids = monthsBetween(range.from, range.to).flatMap((month) => {
    const id = kind === 'cashflow' ? cashCatDocId(month) : plDocId(month)
    return [id, excludedDocId(id)]
  })
  const counts = await countQueries(r, plan.map((p) => p.query), stats)
  assertWithinCap(counts.reduce((a, b) => a + b, ids.length + arrivalReads), cap)
  const docs: RollupDocs = new Map()
  for (const snaps of await readPlan(r, plan, counts)) for (const d of snaps) docs.set(d.id, flatten(d.data()))
  for (const s of await r.getAll(ids.map((id) => rollupsCol(db, orgId).doc(id)))) if (s.exists) docs.set(s.id, flatten(s.data()))
  const read = counts.reduce((a, b) => a + b, 0) + ids.length
  stats.rollups += read
  stats.reads += read
  return docs
}

interface FactsRead {
  context: ReportContext
  /** The chosen accounts (every account without an account filter). */
  accounts: LedgerAccount[]
  includeExcluded: boolean
  /** Every operation of the chosen accounts in the period. */
  scope: ReportFacts
  /** The operations the report chose. */
  report: ReportFacts
  days: { openingDay: string; closingDay: string }
  balances: Map<string, Map<string, number>>
  coverage: Coverage
  stats: ReportReadStats
}

async function readFacts(deps: LedgerDeps, orgId: string, q: ReportQuery, kind: ReportKind, opts: ReadReportOptions): Promise<FactsRead> {
  const { db } = deps
  const today = deps.today()
  const days = reconciliationDays(q.from, q.to, today)
  const source = opts.source ?? reportSource(q)
  const includeExcluded = includesExcluded(q.filters)
  const range: DayRange = { from: q.from, to: q.to }
  return readSnapshot(db, async (snapshotReader) => {
    const stats: ReportReadStats = { operations: 0, rollups: 0, aggregates: 0, reads: 0 }
    const operationIds = new Set<string>()
    const cap = opts.cap ?? REPORT_SCAN_CAP
    const context = await readContext(snapshotReader, db, orgId)
    // The company, its accounts and categories are not counted against the cap; every read after them is.
    const r = observed(snapshotReader, opts.onRead)
    const chosen = new Set(q.filters.accountIds)
    const accounts = chosen.size === 0 ? context.accounts : context.accounts.filter((a) => chosen.has(a.id))
    const scopeIds = new Set(accounts.map((a) => a.id))
    const base = context.baseCurrency
    let scope: ReportFacts
    let report: ReportFacts
    let uncountable: number | null = null
    /** The operations that reach the report: a payment in the period (or a transfer's arrival), an accrual overlapping it. */
    const reaching = new Set<string>()
    // The arrival documents of the balances are read too (the day before the period, the closing day): counted with the rest, so
    // the cap holds for every document the request reads, and a refusal reads none.
    const arrivals = await countArrivals(r, deps, orgId, accounts, [days.openingDay, days.closingDay], today)
    stats.aggregates += arrivals.size
    const arrivalReads = [...arrivals.values()].reduce((a, b) => a + b, 0)

    if (source === 'rollups') {
      const docs = await readRollups(r, db, orgId, [...scopeIds], range, kind, cap, stats, arrivalReads)
      scope = factsFromRollupDocs(selectRollupDocs(docs, scopeIds, range, kind))
      report = scope
    } else {
      const unreadable = new Set<string>()
      // Every query of the request is counted before the first document is read (a refusal reads nothing). A transfer's money
      // arrives within MAX_ARRIVAL_DAYS of its payment day: those payments are read too, their days kept.
      const paidPlan: PlannedQuery = { query: paymentsQuery(db, orgId, addDays(q.from, -MAX_ARRIVAL_DAYS), addDays(q.to, MAX_ARRIVAL_DAYS)), fields: REPORT_FIELDS }
      const plan: PlannedQuery[] = [paidPlan]
      let counts: number[]
      if (kind === 'pl') {
        // The accrual periods come by the cheaper of their two shapes: both are counted, only that one is read.
        const dayPlan: PlannedQuery = { query: accrualDaysQuery(db, orgId, q.from, q.to), fields: REPORT_FIELDS }
        const starts = accrualStartsQuery(db, orgId, q.from, q.to)
        const ends = accrualEndsQuery(db, orgId, q.from, q.to)
        const [paidCount, dayCount, startsCount, endsCount] = await countQueries(r, [paidPlan.query, dayPlan.query, starts, ends], stats)
        const period = startsCount <= endsCount ? { query: starts, count: startsCount } : { query: ends, count: endsCount }
        plan.push(dayPlan, { query: period.query, fields: REPORT_FIELDS })
        counts = [paidCount, dayCount, period.count]
      } else {
        counts = await countQueries(r, [paidPlan.query], stats)
      }
      assertWithinCap(counts.reduce((a, b) => a + b, arrivalReads), cap)
      stats.reads += counts.reduce((a, b) => a + b, 0)
      const [paidDocs, byDay = [], byPeriod = []] = await readPlan(r, plan, counts)
      const paidRead = parseOps(paidDocs, operationIds)
      const paid = paidRead.ops
      for (const tx of paid) if (reachesPeriod(tx.paymentDate, tx.type, range)) reaching.add(tx.id)
      for (const d of paidRead.malformed) {
        if (!malformedPaymentReaches(d.data(), range)) continue
        unreadable.add(d.id)
        reaching.add(d.id)
      }
      const inScope = chosen.size === 0 ? paid : paid.filter((tx) => matchesSharedChoices(tx, { accountIds: q.filters.accountIds, counterpartyIds: [], tagIds: [] }))
      const scoped = operationRollups(inScope, base, range, { accounts: scopeIds, parts: ['cash'] })
      const reported = operationRollups(filterForAnalytics(paid, q.filters, context.categoryTypes).operations, base, range, {
        accounts: scopeIds,
        parts: kind === 'cashflow' ? ['cash', 'cashcat'] : ['cash'],
      })
      const paidById = new Map(paid.map((tx) => [tx.id, tx]))
      for (const id of scoped.uncountable) {
        const tx = paidById.get(id)
        if (tx && reachesPeriod(tx.paymentDate, tx.type, range)) unreadable.add(id)
      }
      if (kind === 'pl') {
        // Operations of the accrual queries. An accrual day lies in the period by the query; an accrual period is in it only when
        // it overlaps the period (the query reads the periods that start or end near it, not only the overlapping ones).
        const accrued = new Map<string, LedgerTransaction>()
        const byDayRead = parseOps(byDay, operationIds)
        const byPeriodRead = parseOps(byPeriod, operationIds)
        for (const d of byDayRead.malformed) {
          unreadable.add(d.id)
          reaching.add(d.id)
        }
        for (const d of byPeriodRead.malformed) {
          if (!malformedPeriodReaches(d.data(), range)) continue
          unreadable.add(d.id)
          reaching.add(d.id)
        }
        for (const tx of byDayRead.ops) {
          accrued.set(tx.id, tx)
          reaching.add(tx.id)
        }
        for (const tx of byPeriodRead.ops) {
          if (tx.accrual.mode !== 'period' || tx.accrual.from > q.to || tx.accrual.to < q.from) continue
          accrued.set(tx.id, tx)
          reaching.add(tx.id)
        }
        const recognised = operationRollups(filterForAnalytics([...accrued.values()], q.filters, context.categoryTypes).operations, base, range, { parts: ['pl'] })
        for (const id of recognised.uncountable) unreadable.add(id)
        addInto(reported.docs, recognised.docs)
      }
      scope = factsFromRollupDocs(scoped.docs)
      report = factsFromRollupDocs(reported.docs)
      uncountable = unreadable.size
    }

    // The arrival documents of the balances are operations too: the same set, so one that two reads return counts once.
    const balanceStats: BalanceReadStats = { docsRead: 0, aggregates: 0, ids: operationIds, counted: arrivals }
    const balances = await balancesAt(r, deps, orgId, accounts, [days.openingDay, days.closingDay], today, balanceStats)
    stats.aggregates += balanceStats.aggregates
    stats.reads += balanceStats.docsRead
    stats.operations = operationIds.size
    const coverage: Coverage = { source, operationsRead: reaching.size, rollupsRead: stats.rollups, uncountable }
    return { context, accounts, includeExcluded, scope, report, days, balances, coverage, stats }
  })
}

/** The chosen accounts with their balances at the close of the opening day and of the closing day (one owner for both). */
function balanceLines(read: FactsRead): ReconcileAccount[] {
  return read.accounts.map((a) => ({
    accountId: a.id,
    currency: a.currency,
    openingMinor: read.balances.get(a.id)?.get(read.days.openingDay) ?? a.balanceMinor,
    closingMinor: read.balances.get(a.id)?.get(read.days.closingDay) ?? a.balanceMinor,
  }))
}

async function reconciliationOf(deps: LedgerDeps, read: FactsRead, rateMonths: number | undefined): Promise<Reconciliation> {
  const base = read.context.baseCurrency
  const accounts = balanceLines(read)
  // The rates come after the snapshot: they are not part of the equation's data and may wait for NBP.
  const quoted = await quoteRates(deps.resolveRate, base, ratesForReconciliation(accounts, read.scope, read.days, base), rateMonths)
  return reconcile({
    baseCurrency: base,
    days: read.days,
    accounts,
    scope: read.scope,
    report: read.report,
    includeExcluded: read.includeExcluded,
    rates: quoted.book,
    unrequestedRates: quoted.unrequested,
  })
}

export async function readCashFlowReport(deps: LedgerDeps, orgId: string, q: ReportQuery, opts: ReadReportOptions = {}): Promise<ReportRead<CashFlowReport>> {
  const read = await readFacts(deps, orgId, q, 'cashflow', opts)
  // The rows show their balances when only accounts are chosen: then they close on the whole movement of each account.
  const balances = hasNonAccountFilters(q.filters) ? undefined : new Map(balanceLines(read).map((a) => [a.accountId, { openingMinor: a.openingMinor, closingMinor: a.closingMinor }]))
  const core = buildCashFlowCore(read.report, {
    from: q.from,
    to: q.to,
    accountIds: read.accounts.map((a) => a.id),
    includeExcluded: read.includeExcluded,
    categoryTypes: read.context.categoryTypes,
    balances,
  })
  const reconciliation = await reconciliationOf(deps, read, opts.rateMonths)
  return {
    report: { kind: 'cashflow', from: q.from, to: q.to, currency: read.context.baseCurrency, ...core, reconciliation, coverage: read.coverage },
    stats: read.stats,
    context: read.context,
  }
}

export async function readPLReport(deps: LedgerDeps, orgId: string, q: ReportQuery, opts: ReadReportOptions = {}): Promise<ReportRead<PLReport>> {
  const read = await readFacts(deps, orgId, q, 'pl', opts)
  const core = buildPLCore(read.report, { from: q.from, to: q.to, includeExcluded: read.includeExcluded, categoryTypes: read.context.categoryTypes })
  const reconciliation = await reconciliationOf(deps, read, opts.rateMonths)
  return {
    report: { kind: 'pl', from: q.from, to: q.to, currency: read.context.baseCurrency, ...core, reconciliation, coverage: read.coverage },
    stats: read.stats,
    context: read.context,
  }
}
