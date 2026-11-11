// lib/server/reports/read.ts
// The server reports (S12). All the reads of one request are one read-only snapshot (`readSnapshot`), then the pure
// builders of lib/domain/reports. Without filters over whole months the figures come from the rollups (the daily
// documents of the period's accounts and two documents a month); otherwise from the operations of the period. Either way
// the queries are counted first in the same snapshot: more than the cap is a refusal before any document is read.
import { FieldPath, type Firestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { filterForAnalytics, includesExcluded } from '@/lib/domain/analytics-filter/filter'
import { categoryTypesOf, type CategoryTypes } from '@/lib/domain/analytics-filter/kinds'
import { matchesSharedChoices } from '@/lib/domain/journal/filter'
import { addDays, monthsBetween } from '@/lib/domain/ledger/days'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { addInto, cashCatDocId, cashDocId, excludedDocId, flatten, plDocId, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { MAX_ARRIVAL_DAYS, type LedgerAccount, type LedgerTransaction } from '@/lib/domain/ledger/types'
import { buildCashFlowCore } from '@/lib/domain/reports/cashflow'
import { parseReportCategory, type ReportCategory } from '@/lib/domain/reports/categories'
import { ReportError } from '@/lib/domain/reports/errors'
import { factsFromRollupDocs, operationRollups, selectRollupDocs, type DayRange } from '@/lib/domain/reports/facts'
import { buildPLCore } from '@/lib/domain/reports/pl'
import { reportSource } from '@/lib/domain/reports/query'
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
import { balancesAt, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, categoriesCol, orgRef, rollupsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readSnapshot, type Reader } from '@/lib/server/ledger/reader'
import { quoteRates } from './rates'

/** The fields a report reads of an operation: what `parseTransaction` checks and what `contributions` and the filters use. */
export const REPORT_FIELDS = [
  'schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'accrual', 'isRecurring', 'tags', 'fileUrls',
  'toAccountId', 'toAmountMinor', 'toCurrency', 'toDate', 'categoryId', 'counterpartyId', 'base', 'excluded',
] as const

/** What one request read: operation documents, rollup documents, aggregate queries (count and sum). */
export interface ReportReadStats {
  operations: number
  rollups: number
  aggregates: number
}

export interface ReportContext {
  baseCurrency: string
  accounts: LedgerAccount[]
  categories: ReportCategory[]
  categoryTypes: CategoryTypes
}

export interface ReadReportOptions {
  /** Tests and the rollout check: another read limit, or one path forced. */
  cap?: number
  source?: ReportSource
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

/** Operations whose accrual period ends on or after `from` (the automatic single-field index of `accrual.to`); the start is checked in memory. */
export function accrualPeriodsQuery(db: Firestore, orgId: string, from: string): Query {
  return transactionsCol(db, orgId).where('accrual.to', '>=', from)
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

interface Budget {
  cap: number
  used: number
}

/**
 * Counts the queries, refuses when their documents would pass the cap, then reads exactly what was counted: one snapshot,
 * so the count is what the reads return. Completeness comes from what was examined, never from a hope.
 */
async function readCounted(r: Reader, queries: readonly Query[], budget: Budget, stats: ReportReadStats, fields?: readonly string[]): Promise<QueryDocumentSnapshot[][]> {
  const counts = await Promise.all(queries.map(async (q) => (await r.aggregate(q.count())).data().count))
  stats.aggregates += queries.length
  const total = counts.reduce((a, b) => a + b, 0)
  if (budget.used + total > budget.cap) throw new ReportError('too_many_operations', { cap: budget.cap })
  budget.used += total
  return Promise.all(queries.map(async (q, i) => (counts[i] === 0 ? [] : (await r.query((fields ? q.select(...fields) : q).limit(counts[i]))).docs)))
}

function parseOps(docs: readonly QueryDocumentSnapshot[], unreadable: Set<string>): LedgerTransaction[] {
  const out: LedgerTransaction[] = []
  for (const d of docs) {
    const tx = parseTransaction(d.id, d.data())
    if (tx) out.push(tx)
    else unreadable.add(d.id)
  }
  return out
}

async function readRollups(r: Reader, db: Firestore, orgId: string, accountIds: readonly string[], range: DayRange, kind: ReportKind, budget: Budget, stats: ReportReadStats): Promise<RollupDocs> {
  const before = budget.used
  const queries = accountIds.flatMap((id) => [cellsQuery(db, orgId, id, range.from, range.to, false), cellsQuery(db, orgId, id, range.from, range.to, true)])
  const docs: RollupDocs = new Map()
  for (const snaps of await readCounted(r, queries, budget, stats)) for (const d of snaps) docs.set(d.id, flatten(d.data()))
  const ids = monthsBetween(range.from, range.to).flatMap((month) => {
    const id = kind === 'cashflow' ? cashCatDocId(month) : plDocId(month)
    return [id, excludedDocId(id)]
  })
  if (budget.used + ids.length > budget.cap) throw new ReportError('too_many_operations', { cap: budget.cap })
  budget.used += ids.length
  for (const s of await r.getAll(ids.map((id) => rollupsCol(db, orgId).doc(id)))) if (s.exists) docs.set(s.id, flatten(s.data()))
  stats.rollups += budget.used - before
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
  return readSnapshot(db, async (r) => {
    const stats: ReportReadStats = { operations: 0, rollups: 0, aggregates: 0 }
    const budget: Budget = { cap: opts.cap ?? REPORT_SCAN_CAP, used: 0 }
    const context = await readContext(r, db, orgId)
    const chosen = new Set(q.filters.accountIds)
    const accounts = chosen.size === 0 ? context.accounts : context.accounts.filter((a) => chosen.has(a.id))
    const scopeIds = new Set(accounts.map((a) => a.id))
    const base = context.baseCurrency
    let scope: ReportFacts
    let report: ReportFacts
    let uncountable: number | null = null

    if (source === 'rollups') {
      const docs = await readRollups(r, db, orgId, [...scopeIds], range, kind, budget, stats)
      scope = factsFromRollupDocs(selectRollupDocs(docs, scopeIds, range, kind))
      report = scope
    } else {
      const unreadable = new Set<string>()
      const before = budget.used
      // A transfer's money arrives within MAX_ARRIVAL_DAYS of its payment day: those payments are read too, their days kept.
      const [paidDocs] = await readCounted(r, [paymentsQuery(db, orgId, addDays(q.from, -MAX_ARRIVAL_DAYS), addDays(q.to, MAX_ARRIVAL_DAYS))], budget, stats, REPORT_FIELDS)
      const paid = parseOps(paidDocs, unreadable)
      const inScope = chosen.size === 0 ? paid : paid.filter((tx) => matchesSharedChoices(tx, { accountIds: q.filters.accountIds, counterpartyIds: [], tagIds: [] }))
      const scoped = operationRollups(inScope, base, range, { accounts: scopeIds, parts: ['cash'] })
      const reported = operationRollups(filterForAnalytics(paid, q.filters, context.categoryTypes).operations, base, range, {
        accounts: scopeIds,
        parts: kind === 'cashflow' ? ['cash', 'cashcat'] : ['cash'],
      })
      for (const id of scoped.uncountable) unreadable.add(id)
      if (kind === 'pl') {
        const [byDay, byPeriod] = await readCounted(r, [accrualDaysQuery(db, orgId, q.from, q.to), accrualPeriodsQuery(db, orgId, q.from)], budget, stats, REPORT_FIELDS)
        const accrued = new Map<string, LedgerTransaction>()
        for (const tx of parseOps(byDay, unreadable)) accrued.set(tx.id, tx)
        for (const tx of parseOps(byPeriod, unreadable)) if (tx.accrual.mode === 'period' && tx.accrual.from <= q.to) accrued.set(tx.id, tx)
        const recognised = operationRollups(filterForAnalytics([...accrued.values()], q.filters, context.categoryTypes).operations, base, range, { parts: ['pl'] })
        for (const id of recognised.uncountable) unreadable.add(id)
        addInto(reported.docs, recognised.docs)
      }
      stats.operations += budget.used - before
      scope = factsFromRollupDocs(scoped.docs)
      report = factsFromRollupDocs(reported.docs)
      uncountable = unreadable.size
    }

    const balanceStats: BalanceReadStats = { docsRead: 0, aggregates: 0 }
    const balances = await balancesAt(r, deps, orgId, accounts, [days.openingDay, days.closingDay], today, balanceStats)
    stats.aggregates += balanceStats.aggregates
    stats.operations += balanceStats.docsRead
    const coverage: Coverage = { source, operationsRead: stats.operations, rollupsRead: stats.rollups, uncountable }
    return { context, accounts, includeExcluded, scope, report, days, balances, coverage, stats }
  })
}

async function reconciliationOf(deps: LedgerDeps, read: FactsRead): Promise<Reconciliation> {
  const base = read.context.baseCurrency
  const accounts: ReconcileAccount[] = read.accounts.map((a) => ({
    accountId: a.id,
    currency: a.currency,
    openingMinor: read.balances.get(a.id)?.get(read.days.openingDay) ?? a.balanceMinor,
    closingMinor: read.balances.get(a.id)?.get(read.days.closingDay) ?? a.balanceMinor,
  }))
  // The rates come after the snapshot: they are not part of the equation's data and may wait for NBP.
  const rates = await quoteRates(deps.resolveRate, base, ratesForReconciliation(accounts, read.scope, read.days, base))
  return reconcile({ baseCurrency: base, days: read.days, accounts, scope: read.scope, report: read.report, includeExcluded: read.includeExcluded, rates })
}

export async function readCashFlowReport(deps: LedgerDeps, orgId: string, q: ReportQuery, opts: ReadReportOptions = {}): Promise<ReportRead<CashFlowReport>> {
  const read = await readFacts(deps, orgId, q, 'cashflow', opts)
  const core = buildCashFlowCore(read.report, {
    from: q.from,
    to: q.to,
    accountIds: read.accounts.map((a) => a.id),
    includeExcluded: read.includeExcluded,
    categoryTypes: read.context.categoryTypes,
  })
  const reconciliation = await reconciliationOf(deps, read)
  return {
    report: { kind: 'cashflow', from: q.from, to: q.to, currency: read.context.baseCurrency, ...core, reconciliation, coverage: read.coverage },
    stats: read.stats,
    context: read.context,
  }
}

export async function readPLReport(deps: LedgerDeps, orgId: string, q: ReportQuery, opts: ReadReportOptions = {}): Promise<ReportRead<PLReport>> {
  const read = await readFacts(deps, orgId, q, 'pl', opts)
  const core = buildPLCore(read.report, { from: q.from, to: q.to, includeExcluded: read.includeExcluded, categoryTypes: read.context.categoryTypes })
  const reconciliation = await reconciliationOf(deps, read)
  return {
    report: { kind: 'pl', from: q.from, to: q.to, currency: read.context.baseCurrency, ...core, reconciliation, coverage: read.coverage },
    stats: read.stats,
    context: read.context,
  }
}
