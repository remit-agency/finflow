// lib/server/journal/read.ts
import { AggregateField, FieldPath, Filter, Timestamp, type DocumentSnapshot, type Query } from 'firebase-admin/firestore'
import { balancesAfter, type DayOps } from '@/lib/domain/journal/balance'
import { matchesFilters, type FilterContext, type JournalFilters } from '@/lib/domain/journal/filter'
import { compareKeys, encodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import type { JournalPage, JournalRow } from '@/lib/domain/journal/types'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { cashDocId } from '@/lib/domain/ledger/rollups'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, counterpartiesCol, rollupsCol, transactionsCol } from '@/lib/server/ledger/paths'

/** Documents one request may read while looking for a full page. */
export const SCAN_CAP = 2000
const SCAN_CHUNK = 200

export interface ReadOptions {
  filters: JournalFilters
  cursor: JournalKey | null
  limit: number
  /** For tests. */
  scanCap?: number
}

/** What a request read, for the budget test: operation documents, rollup documents, aggregate queries. */
export interface ReadStats {
  docsRead: number
  aggregates: number
}

export type ReadResult = JournalPage & { stats: ReadStats }

/**
 * The position of a document in the listing, or null when it has no payment date to sit under. A creation time that
 * is not a timestamp counts as the oldest possible one (the operation is still listed, last in its day).
 */
function keyOf(d: DocumentSnapshot): JournalKey | null {
  const created = d.get('createdAt')
  const paymentDate = d.get('paymentDate')
  if (typeof paymentDate !== 'string') return null
  const [createdAtS, createdAtN] = created instanceof Timestamp ? [created.seconds, created.nanoseconds] : [0, 0]
  return { paymentDate, createdAtS, createdAtN, id: d.id }
}

function needsScan(f: JournalFilters): boolean {
  return (
    f.types.length > 0 ||
    f.status !== undefined ||
    f.minMinor !== undefined ||
    f.maxMinor !== undefined ||
    f.categoryIds.length > 0 ||
    f.counterpartyIds.length > 0 ||
    !!f.q ||
    (f.basis === 'accrual' && (f.from !== undefined || f.to !== undefined))
  )
}

/** The part of the filters Firestore answers through the indexes: the account and a payment-date range. */
function baseQuery(deps: LedgerDeps, orgId: string, f: JournalFilters): Query {
  let q: Query = transactionsCol(deps.db, orgId)
  if (f.accountId) q = q.where(Filter.or(Filter.where('accountId', '==', f.accountId), Filter.where('toAccountId', '==', f.accountId)))
  if (f.basis === 'payment') {
    if (f.from) q = q.where('paymentDate', '>=', f.from)
    if (f.to) q = q.where('paymentDate', '<=', f.to)
  }
  return q.orderBy('paymentDate', 'desc').orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
}

function after(q: Query, key: JournalKey): Query {
  return q.startAfter(key.paymentDate, new Timestamp(key.createdAtS, key.createdAtN), key.id)
}

/**
 * One operation as it is now: the journal's rows can be minutes old (no live listener), and an edit must start from
 * fresh data. `null` when the document is missing or is not a ledger v2 operation.
 */
export async function readOneTransaction(deps: LedgerDeps, orgId: string, txId: string): Promise<LedgerTransaction | null> {
  const snap = await transactionsCol(deps.db, orgId).doc(txId).get()
  if (!snap.exists) return null
  return parseTransaction(snap.id, snap.data() ?? {})
}

export async function readJournalPage(deps: LedgerDeps, orgId: string, opts: ReadOptions): Promise<ReadResult> {
  const stats: ReadStats = { docsRead: 0, aggregates: 0 }
  const { filters, limit } = opts
  const cap = opts.scanCap ?? SCAN_CAP

  // Accounts (names, balances) and, for a text search, counterparty names: small collections, not counted as operations.
  const accounts = new Map<string, LedgerAccount>()
  for (const d of (await accountsCol(deps.db, orgId).get()).docs) {
    const a = parseAccount(d.id, d.data())
    if (a) accounts.set(a.id, a)
  }
  const counterpartyNames = new Map<string, string>()
  if (filters.q) {
    for (const d of (await counterpartiesCol(deps.db, orgId).get()).docs) {
      const name = d.get('name')
      if (typeof name === 'string') counterpartyNames.set(d.id, name)
    }
  }
  const ctx: FilterContext = { accountName: (id) => accounts.get(id)?.name, counterpartyName: (id) => counterpartyNames.get(id) }

  const base = baseQuery(deps, orgId, filters)
  const scan = needsScan(filters)
  const rows: JournalRow[] = []
  // `lastKey` is the last VALID position (what the next cursor encodes); `position` is the last document read, valid or
  // not, so a document that cannot be placed never makes the next query return it again.
  let lastKey = opts.cursor
  let position: DocumentSnapshot | null = null
  let scanned = 0
  let more = true
  let full = false

  while (rows.length < limit && scanned < cap && more) {
    // The chunk never goes past the cap, so one request reads at most `cap` documents for the scan.
    const size = scan ? Math.min(SCAN_CHUNK, cap - scanned) : Math.min(SCAN_CHUNK, limit - rows.length)
    // The incoming cursor is a key; inside one request the query continues from the document itself.
    const from: Query = position ? base.startAfter(position) : opts.cursor ? after(base, opts.cursor) : base
    const snap = await from.limit(size).get()
    stats.docsRead += snap.size
    for (const d of snap.docs) {
      position = d
      scanned++
      const key = keyOf(d)
      if (!key) continue
      lastKey = key
      const tx = parseTransaction(d.id, d.data())
      if (tx && matchesFilters(tx, filters, ctx)) {
        rows.push({ tx, balanceAfterMinor: null })
        if (rows.length === limit) {
          full = true
          break
        }
      }
    }
    if (snap.size < size) more = false
  }

  await attachBalances(deps, orgId, rows, accounts, stats)
  return { rows, next: lastKey !== null && (full || more) ? encodeCursor(lastKey) : null, stats }
}

// ---- balance after each operation ----------------------------------------------------------------------------

interface DayNet {
  inMinor?: number
  outMinor?: number
  transferInMinor?: number
  transferOutMinor?: number
}

const netOf = (d: DayNet): number => (d.inMinor ?? 0) - (d.outMinor ?? 0) + (d.transferInMinor ?? 0) - (d.transferOutMinor ?? 0)

/**
 * The net movement of an account on every day after `day`.
 *
 * Firestore cannot `sum` over a range of document ids (the index it needs, `__name__` followed by the summed field,
 * does not exist), so the daily rollups cannot be aggregated by id. The same totals come from three sum queries over
 * the actual operations themselves: money in (income), money out (expense and transfer out, both `amountMinor`) and
 * transfers into the account (`toAmountMinor`). They are billed by index entries, not by documents read.
 */
async function netAfterDay(deps: LedgerDeps, orgId: string, accountId: string, day: string, stats: ReadStats): Promise<number> {
  const actualAfter = transactionsCol(deps.db, orgId).where('status', '==', 'actual').where('paymentDate', '>', day)
  const sum = async (q: Query, field: string): Promise<number> => {
    const agg = await q.aggregate({ total: AggregateField.sum(field) }).get()
    stats.aggregates++
    return agg.data().total ?? 0
  }
  const [income, outflow, transferIn] = await Promise.all([
    sum(actualAfter.where('accountId', '==', accountId).where('type', '==', 'income'), 'amountMinor'),
    sum(actualAfter.where('accountId', '==', accountId).where('type', 'in', ['expense', 'transfer']), 'amountMinor'),
    sum(actualAfter.where('toAccountId', '==', accountId), 'toAmountMinor'),
  ])
  return income - outflow + transferIn
}

/** Net movement per day for the days from `oldest` to `newest` that have a rollup. */
async function netsBetween(deps: LedgerDeps, orgId: string, accountId: string, oldest: string, newest: string, stats: ReadStats): Promise<Map<string, number>> {
  const col = rollupsCol(deps.db, orgId)
  const snap = await col
    .where(FieldPath.documentId(), '>=', col.doc(cashDocId(accountId, oldest)))
    .where(FieldPath.documentId(), '<=', col.doc(cashDocId(accountId, newest)))
    .get()
  stats.docsRead += snap.size
  const prefix = cashDocId(accountId, '')
  const out = new Map<string, number>()
  for (const d of snap.docs) out.set(d.id.slice(prefix.length), netOf(d.data() as DayNet))
  return out
}

/** Every actual operation that moves the account on `day`, in listing order, with its effect on the account. */
async function opsOfDay(deps: LedgerDeps, orgId: string, accountId: string, day: string, stats: ReadStats): Promise<DayOps['ops']> {
  const snap = await transactionsCol(deps.db, orgId)
    .where(Filter.and(Filter.where('paymentDate', '==', day), Filter.or(Filter.where('accountId', '==', accountId), Filter.where('toAccountId', '==', accountId))))
    .get()
  stats.docsRead += snap.size
  const listed: { key: JournalKey; id: string; effect: number }[] = []
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    if (!tx || tx.status !== 'actual') continue
    // An operation without a creation time cannot be listed, but it still moved the balance: keep it, last in its day.
    const key = keyOf(d) ?? { paymentDate: day, createdAtS: 0, createdAtN: 0, id: d.id }
    listed.push({ key, id: d.id, effect: balanceEffects(tx)[accountId] ?? 0 })
  }
  return listed.sort((a, b) => compareKeys(a.key, b.key)).map(({ id, effect }) => ({ id, effect }))
}

async function attachBalances(deps: LedgerDeps, orgId: string, rows: JournalRow[], accounts: Map<string, LedgerAccount>, stats: ReadStats): Promise<void> {
  const byAccount = new Map<string, JournalRow[]>()
  for (const row of rows) {
    if (row.tx.status !== 'actual') continue
    byAccount.set(row.tx.accountId, [...(byAccount.get(row.tx.accountId) ?? []), row])
  }

  // The accounts are independent, and so are the reads of one account: all of them go out together.
  await Promise.all(
    [...byAccount].map(async ([accountId, accountRows]) => {
      const account = accounts.get(accountId)
      if (!account) return
      const days = [...new Set(accountRows.map((r) => r.tx.paymentDate))].sort().reverse() // newest first
      const newest = days[0]
      const oldest = days[days.length - 1]

      const [netAfter, nets, dayOps] = await Promise.all([
        netAfterDay(deps, orgId, accountId, newest, stats),
        days.length > 1 ? netsBetween(deps, orgId, accountId, oldest, newest, stats) : Promise.resolve(new Map<string, number>()),
        Promise.all(days.map(async (day): Promise<DayOps> => ({ day, ops: await opsOfDay(deps, orgId, accountId, day, stats) }))),
      ])

      const netBetween = days.slice(0, -1).map((newer, i) => {
        const older = days[i + 1]
        let sum = 0
        for (const [day, net] of nets) if (day > older && day < newer) sum += net
        return sum
      })

      const result = balancesAfter(account.balanceMinor, netAfter, dayOps, netBetween)
      for (const row of accountRows) row.balanceAfterMinor = result.get(row.tx.id) ?? null
    }),
  )
}
