import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { assertBankUnlocked } from '@/lib/domain/ledger/bank-lock'
import { changeSet } from '@/lib/domain/ledger/change'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { applyPatch, toRawInput, type TransactionInput, type TransactionPatch } from '@/lib/domain/ledger/input'
import { nest } from '@/lib/domain/ledger/rollups'
import type { BankInfo, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'
import type { RateSnapshot } from '@/lib/server/fx/types'
import { auditData, type AuditAction } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, rollupsCol, transactionsCol } from './paths'

export interface WriteResult {
  transaction: LedgerTransaction
  /** True when a create with an already used clientId returned the existing operation. */
  replayed: boolean
}

/** A fully built operation plus what the build assumed about the world (re-checked inside the transaction). */
interface Prepared {
  tx: LedgerTransaction
  baseCurrency: string
  /** accountId -> currency the build assumed. */
  currencies: Record<string, string>
}

interface Job {
  action: AuditAction
  txId: string
  prior: { tx: LedgerTransaction; version: Timestamp } | null
  next: Prepared | null
}

export function evidenceOf(s: RateSnapshot): RateEvidence {
  // Only final snapshots may be stored for good (S04). The plan never asks for a date after today.
  if (!s.final) throw new Error('refusing to store a non-final rate snapshot')
  return { rate: s.rate, from: s.from, to: s.to, requestedDate: s.requestedDate, rateDate: s.rateDate, tableNo: s.tableNo, source: s.source }
}

async function loadAccount(deps: LedgerDeps, orgId: string, id: string) {
  const snap = await accountsCol(deps.db, orgId).doc(id).get()
  return snap.exists ? parseAccount(snap.id, snap.data()) : null
}

/** Reads what the input depends on, builds the operation and resolves its rates (network, so outside the transaction). */
async function prepare(deps: LedgerDeps, orgId: string, txId: string, input: TransactionInput): Promise<Prepared> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const baseCurrency = org.get('currency') as string

  const account = await loadAccount(deps, orgId, input.accountId)
  if (!account) throw new LedgerError('account_not_found', 'accountId')
  const toAccount = input.toAccountId === undefined ? undefined : await loadAccount(deps, orgId, input.toAccountId)
  if (input.toAccountId !== undefined && !toAccount) throw new LedgerError('account_not_found', 'toAccountId')

  let category: { type: 'income' | 'expense' } | null = null
  if (input.categoryId !== undefined) {
    const snap = await categoriesCol(deps.db, orgId).doc(input.categoryId).get()
    const type = snap.get('type')
    if (snap.exists && (type === 'income' || type === 'expense')) category = { type }
  }

  const today = deps.today()
  const built = buildTransaction(txId, input, { today, account, toAccount: toAccount ?? undefined, category, baseCurrency })
  const plan = fxPlan(built, baseCurrency, today)
  const snapshots = await Promise.all(plan.map((r) => deps.resolveRate(r.from, r.to, r.date)))
  const tx = attachFx(built, plan, snapshots.map(evidenceOf))

  const currencies: Record<string, string> = { [account.id]: account.currency }
  if (toAccount) currencies[toAccount.id] = toAccount.currency
  return { tx, baseCurrency, currencies }
}

function accountIdsOf(tx: LedgerTransaction): string[] {
  return tx.toAccountId === undefined ? [tx.accountId] : [tx.accountId, tx.toAccountId]
}

/** One Firestore transaction: operation + balances + rollup increments + audit. All reads come first. */
async function commit(deps: LedgerDeps, orgId: string, uid: string, job: Job): Promise<WriteResult> {
  const { db } = deps
  const txRef = transactionsCol(db, orgId).doc(job.txId)

  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const currentSnap = await t.get(txRef)

    const involved = new Set<string>([
      ...(job.prior ? accountIdsOf(job.prior.tx) : []),
      ...(job.next ? accountIdsOf(job.next.tx) : []),
    ])
    const accountSnaps = new Map<string, DocumentSnapshot>()
    for (const id of involved) accountSnaps.set(id, await t.get(accountsCol(db, orgId).doc(id)))
    const categoryId = job.next?.tx.categoryId
    const categorySnap = categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(categoryId))
    // A counterparty is checked only when this write gives the operation a new one: an edit of something else
    // must not fail because the counterparty was archived after the operation was made.
    const counterpartyId = job.next?.tx.counterpartyId
    const counterpartyIsNew = counterpartyId !== undefined && counterpartyId !== job.prior?.tx.counterpartyId
    const counterpartySnap = counterpartyId !== undefined && counterpartyIsNew ? await t.get(counterpartiesCol(db, orgId).doc(counterpartyId)) : null

    // ---- checks (nothing is written yet) ----
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const baseCurrency = orgSnap.get('currency') as string
    if (job.next && job.next.baseCurrency !== baseCurrency) throw new LedgerError('conflict')

    if (job.prior === null) {
      if (currentSnap.exists) {
        const existing = parseTransaction(currentSnap.id, currentSnap.data())
        if (!existing) throw new LedgerError('conflict')
        return { transaction: existing, replayed: true }
      }
    } else {
      if (!currentSnap.exists) throw new LedgerError('not_found')
      if (!currentSnap.updateTime || !currentSnap.updateTime.isEqual(job.prior.version)) throw new LedgerError('conflict')
    }

    for (const [id, snap] of accountSnaps) {
      const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
      if (!account) throw new LedgerError('conflict')
      const assumed = job.next && Object.hasOwn(job.next.currencies, id) ? job.next.currencies[id] : undefined
      if (assumed !== undefined && assumed !== account.currency) throw new LedgerError('conflict')
    }
    if (categorySnap !== null && job.next) {
      if (!categorySnap.exists || categorySnap.get('type') !== job.next.tx.type) throw new LedgerError('category_not_found', 'categoryId')
    }
    if (counterpartySnap !== null) {
      if (!counterpartySnap.exists) throw new LedgerError('counterparty_not_found', 'counterpartyId')
      if (counterpartySnap.get('archived') === true) throw new LedgerError('counterparty_archived', 'counterpartyId')
    }

    // ---- writes ----
    const ts = Timestamp.fromDate(deps.now())
    const change = changeSet(job.prior?.tx ?? null, job.next?.tx ?? null, baseCurrency)

    for (const [id, delta] of Object.entries(change.balanceDeltas)) {
      t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
    }
    for (const [id, flat] of change.rollupDeltas) {
      t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
    }

    if (job.next) {
      const old = currentSnap.data() ?? {}
      t.set(txRef, {
        ...transactionToDoc(job.next.tx),
        // Provenance of a migrated operation (S05 migration) outlives edits.
        ...(job.prior && old.migratedFrom !== undefined ? { migratedFrom: old.migratedFrom } : {}),
        ...(job.prior && old.legacy !== undefined ? { legacy: old.legacy } : {}),
        orgId,
        createdAt: job.prior ? (old.createdAt ?? ts) : ts,
        createdBy: job.prior ? (old.createdBy ?? uid) : uid,
        updatedAt: ts,
        updatedBy: uid,
      })
    } else {
      t.delete(txRef)
    }

    t.create(
      auditCol(db, orgId).doc(),
      auditData(
        deps,
        job.action,
        uid,
        job.txId,
        job.prior ? transactionToDoc(job.prior.tx) : null,
        job.next ? transactionToDoc(job.next.tx) : null,
      ),
    )

    return { transaction: job.next ? job.next.tx : (job.prior as NonNullable<typeof job.prior>).tx, replayed: false }
  })
}

export async function createTransaction(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  input: TransactionInput,
  bank?: BankInfo,
): Promise<WriteResult> {
  const txId = input.clientId ?? transactionsCol(deps.db, orgId).doc().id
  const next = await prepare(deps, orgId, txId, input)
  if (bank !== undefined) next.tx = { ...next.tx, bank }
  return commit(deps, orgId, uid, { action: 'tx.create', txId, prior: null, next })
}

async function loadPrior(deps: LedgerDeps, orgId: string, txId: string) {
  const snap = await transactionsCol(deps.db, orgId).doc(txId).get()
  if (!snap.exists) throw new LedgerError('not_found')
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx || !snap.updateTime) throw new LedgerError('conflict')
  return { tx, version: snap.updateTime }
}

export async function updateTransaction(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  txId: string,
  patch: TransactionPatch,
): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  const next = await prepare(deps, orgId, txId, applyPatch(toRawInput(prior.tx), patch))
  if (prior.tx.bank !== undefined) {
    assertBankUnlocked(prior.tx, next.tx)
    // toRawInput never carries `bank`, so an edit keeps the provenance from the prior document.
    next.tx = { ...next.tx, bank: prior.tx.bank }
  }
  return commit(deps, orgId, uid, { action: 'tx.update', txId, prior, next })
}

export async function deleteTransaction(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  return commit(deps, orgId, uid, { action: 'tx.delete', txId, prior, next: null })
}
