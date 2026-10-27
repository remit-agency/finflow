// Runner for the schema 1 -> schema 2 ledger migration (S05). Takes LedgerDeps, so the same code runs against the
// Firestore emulator in tests and against production from scripts/migrate-ledger-v2.ts. Imports no `server-only` module.
import { FieldValue, Timestamp, type DocumentReference, type WriteBatch } from 'firebase-admin/firestore'
import { attachFx } from '@/lib/domain/ledger/build'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects } from '@/lib/domain/ledger/effects'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerAccount, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'
import { auditData } from '@/lib/server/ledger/audit'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, auditCol, orgRef, transactionsCol } from '@/lib/server/ledger/paths'
import { acquireLock, releaseLock, renewLock } from '@/lib/server/ledger/lock'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { evidenceOf } from '@/lib/server/ledger/write'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { planOrg, type LegacyDoc, type Plan, type PlannedTx } from './plan-ledger-v2'
import { simulateRollups } from './simulate-ledger-v2'

/** Operations per write batch (plus the balance increments of the schema 2 accounts they touch, capped by BATCH_WRITES). */
const TX_BATCH = 300
/** Firestore allows 500 writes per batch; stay below. */
const BATCH_WRITES = 450
const DROP_BATCH = 400

export interface MigrateOptions {
  apply: boolean
  /** Accounts that open at 0 (their balance becomes the sum of their operations). */
  resetOpening: Set<string>
  /**
   * Called with the final report right before the first write of an apply. The CLI saves the backup here, so it covers
   * exactly the documents this run changes; a throw aborts the migration before anything is written.
   */
  beforeWrite?: (report: MigrateReport) => Promise<void> | void
}

export interface DriftLine {
  accountId: string
  legacyBalanceMinor: number
  sumMinor: number
  openingMinor: number
}

export interface MigrateReport {
  orgId: string
  applied: boolean
  accountsToMigrate: number
  txsToMigrate: number
  skipped: Plan['skipped']
  counters: Plan['counters']
  drift: DriftLine[]
  /** The raw legacy documents that are changed (Timestamps as ISO strings), for the CLI to save before applying. */
  backup: { accounts: LegacyDoc[]; txs: LegacyDoc[] }
  /** Set after an apply: how many balances the final rebuild had to correct (should be 0). */
  rebuildBalanceFixes?: number
  /** True when the rebuild report was cut at its limit, so `rebuildBalanceFixes` is a lower bound. */
  rebuildTruncated?: boolean
  /** Set when the rollups of the migrated ledger could not be built or written; nothing is applied then. */
  simulationError?: string
}

/** Timestamps and Dates (also nested) as ISO strings; everything else is copied as is. */
function jsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]))
  }
  return value
}

/**
 * Optional text fields the plan leaves out. Whatever the legacy document holds there (null, a number, an empty or
 * invalid id, a blank description) must not survive: the document is merged, so it would stay and either make the
 * schema 2 document unreadable or break the rollups.
 */
const TEXT_FIELDS = ['categoryId', 'description', 'projectId', 'counterpartyId'] as const

function staleTextFields(raw: Record<string, unknown>, tx: LedgerTransaction): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of TEXT_FIELDS) {
    if (key === 'counterpartyId' && tx.type === 'transfer') continue // the legacy transfer target stays until dropLegacy
    if (tx[key] === undefined && raw[key] !== undefined) out[key] = FieldValue.delete()
  }
  return out
}

function accountSums(batch: PlannedTx[]): Map<string, number> {
  const sums = new Map<string, number>()
  for (const { tx } of batch) {
    for (const [id, delta] of Object.entries(balanceEffects(tx))) sums.set(id, (sums.get(id) ?? 0) + delta)
  }
  return sums
}

/**
 * An apply holds the ledger lock for its whole run (writes through the API answer ledger_busy meanwhile; a second
 * migration of the company gets ledger_busy and writes nothing) and renews the lease before every batch. A dry run
 * writes nothing and needs no lock.
 */
export async function migrateOrg(deps: LedgerDeps, orgId: string, opts: MigrateOptions): Promise<MigrateReport> {
  if (!opts.apply) return migrate(deps, orgId, opts, null)
  const token = await acquireLock(deps, orgId, 'migration')
  try {
    return await migrate(deps, orgId, opts, token)
  } finally {
    await releaseLock(deps, orgId, token)
  }
}

async function migrate(deps: LedgerDeps, orgId: string, opts: MigrateOptions, token: string | null): Promise<MigrateReport> {
  const renew = async () => {
    if (token !== null) await renewLock(deps, orgId, token)
  }
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const baseCurrency = org.get('currency') as string

  const legacyAccounts: LegacyDoc[] = []
  const migratedAccounts = new Map<string, string>()
  const migratedAccountDocs: LedgerAccount[] = []
  for (const doc of (await accountsCol(deps.db, orgId).get()).docs) {
    const account = parseAccount(doc.id, doc.data())
    if (account) {
      migratedAccounts.set(doc.id, account.currency)
      migratedAccountDocs.push(account)
    } else legacyAccounts.push({ id: doc.id, data: doc.data() })
  }

  const legacyTxs: LegacyDoc[] = []
  const markedTxs: LedgerTransaction[] = []
  const schema2Txs: LedgerTransaction[] = []
  for (const doc of (await transactionsCol(deps.db, orgId).get()).docs) {
    const data = doc.data()
    const tx = parseTransaction(doc.id, data)
    if (tx) {
      schema2Txs.push(tx)
      if (data.migratedFrom === 'v1') markedTxs.push(tx)
    } else {
      const date = data.date
      legacyTxs.push({ id: doc.id, data: { ...data, date: date instanceof Timestamp ? date.toDate() : date } })
    }
  }

  const today = deps.today()
  const plan = planOrg({ baseCurrency, today, legacyAccounts, migratedAccounts, legacyTxs, markedTxs, resetOpening: opts.resetOpening })

  // Rates first: a failure here throws before anything is written. A date after today is capped (the snapshot must be final).
  const snapshots = new Map<string, RateEvidence>()
  const key = (from: string, to: string, date: string) => `${from}>${to}@${date}`
  const cap = (date: string) => (date > today ? today : date)
  for (const planned of plan.txs) {
    for (const r of planned.fxRequests) {
      const k = key(r.from, r.to, cap(r.date))
      if (snapshots.has(k)) continue
      snapshots.set(k, evidenceOf(await deps.resolveRate(r.from, r.to, cap(r.date))))
    }
  }
  const txs: PlannedTx[] = plan.txs.map((p) => ({
    ...p,
    tx: attachFx(p.tx, p.fxRequests, p.fxRequests.map((r) => snapshots.get(key(r.from, r.to, cap(r.date))) as RateEvidence)),
  }))

  const rawTx = new Map(legacyTxs.map((d) => [d.id, d.data]))
  const rawAccount = new Map(legacyAccounts.map((d) => [d.id, d.data]))
  const report: MigrateReport = {
    orgId,
    applied: false,
    accountsToMigrate: plan.accounts.length,
    txsToMigrate: txs.length,
    skipped: plan.skipped,
    counters: plan.counters,
    drift: plan.accounts
      .filter((a) => a.legacyBalanceMinor !== a.sumMinor)
      .map((a) => ({ accountId: a.id, legacyBalanceMinor: a.legacyBalanceMinor, sumMinor: a.sumMinor, openingMinor: a.openingMinor })),
    backup: {
      accounts: plan.accounts.map((a) => ({ id: a.id, data: jsonSafe(rawAccount.get(a.id)) as Record<string, unknown> })),
      txs: txs.map((t) => ({ id: t.id, data: jsonSafe(rawTx.get(t.id)) as Record<string, unknown> })),
    },
  }

  // What the final rebuild will have to build: the ledger as it will be after this run. A dry run finds in advance what
  // would only fail once the rollups are written.
  const plannedAccounts = plan.accounts.flatMap((a) => parseAccount(a.id, a.fields) ?? [])
  const simulationError = simulateRollups({
    baseCurrency,
    accounts: [...migratedAccountDocs, ...plannedAccounts],
    txs: [...schema2Txs, ...txs.map((t) => t.tx)],
  })
  if (simulationError !== null) report.simulationError = simulationError

  if (!opts.apply || report.simulationError !== undefined) return report
  await opts.beforeWrite?.(report)

  // a. Operations. A batch also moves the balance of the schema 2 accounts it touches, so the operation and its effect
  //    are atomic and a crashed run never counts an operation twice (a migrated operation is no longer legacy).
  const nextBatch = (from: number): { slice: PlannedTx[]; effects: Map<string, number> } => {
    const slice: PlannedTx[] = []
    let touched = new Set<string>()
    for (let i = from; i < txs.length && slice.length < TX_BATCH; i++) {
      const ids = Object.keys(balanceEffects(txs[i].tx)).filter((id) => migratedAccounts.has(id))
      const merged = new Set([...touched, ...ids])
      if (slice.length > 0 && slice.length + 1 + merged.size > BATCH_WRITES) break
      slice.push(txs[i])
      touched = merged
    }
    return { slice, effects: accountSums(slice) }
  }
  for (let i = 0; i < txs.length; ) {
    const { slice, effects } = nextBatch(i)
    await renew()
    const batch: WriteBatch = deps.db.batch()
    for (const planned of slice) {
      batch.set(
        transactionsCol(deps.db, orgId).doc(planned.id),
        {
          ...transactionToDoc(planned.tx),
          ...staleTextFields(rawTx.get(planned.id) ?? {}, planned.tx),
          migratedFrom: 'v1',
          ...(planned.legacyCurrency ? { legacy: { currency: planned.legacyCurrency } } : {}),
        },
        { merge: true },
      )
    }
    for (const [id, delta] of effects) {
      if (migratedAccounts.has(id) && delta !== 0) batch.update(accountsCol(deps.db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta) })
    }
    await batch.commit()
    i += slice.length
  }

  // b. Legacy accounts (the legacy `balance` field stays until dropLegacy).
  for (let i = 0; i < plan.accounts.length; i += BATCH_WRITES) {
    await renew()
    const batch = deps.db.batch()
    for (const a of plan.accounts.slice(i, i + BATCH_WRITES)) batch.set(accountsCol(deps.db, orgId).doc(a.id), a.fields, { merge: true })
    await batch.commit()
  }

  // c. Rollups (and any balance the steps above left off) are recomputed from the operations.
  //    The rebuild runs under the lock this run already holds and renews it itself before each of its batches.
  const rebuilt = await rebuildLedger(deps, orgId, 'migration', { apply: true, lock: token ?? undefined })
  report.rebuildBalanceFixes = rebuilt.balanceDiffs.length
  report.rebuildTruncated = rebuilt.truncated

  // d. One audit entry, only when something was migrated.
  if (plan.accounts.length > 0 || txs.length > 0) {
    await renew()
    await auditCol(deps.db, orgId).doc().create(
      auditData(deps, 'migration.v2', 'migration', orgId, null, {
        accounts: plan.accounts.length,
        transactions: txs.length,
        skipped: plan.skipped.length,
        ...plan.counters,
        drift: report.drift.length,
        rebuildBalanceFixes: report.rebuildBalanceFixes,
      }),
    )
  }
  report.applied = true
  return report
}

export type DropReport = { skipped: 'ledger_not_ok' } | { skipped?: undefined; applied: boolean; accounts: number; transactions: number }

/**
 * Removes the schema 1 fields (account `balance`; operation `date`, `amount`, and a transfer's `counterpartyId`) from
 * schema 2 documents. Refuses unless verifyLedger is ok.
 */
export async function dropLegacy(deps: LedgerDeps, orgId: string, opts: { apply: boolean }): Promise<DropReport> {
  if (!(await verifyLedger(deps, orgId)).ok) return { skipped: 'ledger_not_ok' }

  const updates: Array<{ ref: DocumentReference; fields: Record<string, unknown> }> = []
  let accounts = 0
  let transactions = 0
  for (const doc of (await accountsCol(deps.db, orgId).get()).docs) {
    const data = doc.data()
    if (!parseAccount(doc.id, data) || data.balance === undefined) continue
    updates.push({ ref: doc.ref, fields: { balance: FieldValue.delete() } })
    accounts++
  }
  for (const doc of (await transactionsCol(deps.db, orgId).get()).docs) {
    const data = doc.data()
    const tx = parseTransaction(doc.id, data)
    if (!tx) continue
    const fields: Record<string, unknown> = {}
    if (data.date !== undefined) fields.date = FieldValue.delete()
    if (data.amount !== undefined) fields.amount = FieldValue.delete()
    if (tx.type === 'transfer' && data.counterpartyId !== undefined) fields.counterpartyId = FieldValue.delete()
    if (Object.keys(fields).length === 0) continue
    updates.push({ ref: doc.ref, fields })
    transactions++
  }
  if (!opts.apply) return { applied: false, accounts, transactions }

  for (let i = 0; i < updates.length; i += DROP_BATCH) {
    const batch = deps.db.batch()
    for (const u of updates.slice(i, i + DROP_BATCH)) batch.update(u.ref, u.fields)
    await batch.commit()
  }
  return { applied: true, accounts, transactions }
}
