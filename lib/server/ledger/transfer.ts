import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { attachFx, fxPlan } from '@/lib/domain/ledger/build'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { isLinkedToBank } from './accounts'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, orgRef, tagsCol, transactionsCol } from './paths'
import { applyChange, evidenceOf, storedDoc } from './write'

/**
 * One «make it a transfer» (S10b). `convert`: one bank operation and the account of the other side. `pair`: two bank
 * operations in any order (the expense becomes the transfer, the income goes into it); `versions`, when given, are the
 * versions the person saw (a suggestion), in the order of `ids`.
 */
export type TransferJob =
  | { mode: 'convert'; id: string; toAccountId: string }
  | { mode: 'pair'; ids: readonly [string, string]; versions?: readonly [Timestamp, Timestamp] }

export interface MadeTransfer {
  transaction: LedgerTransaction
  /** The bank operation that went into the transfer (a pair); null for a conversion. */
  deletedId: string | null
  /** Tags of that operation left out because the transfer had 10 already. */
  droppedTags: number
  /** The operations as they were before: what an undo writes back after the split. */
  before: LedgerTransaction[]
}

/** The operation in a snapshot read inside the transaction: gone is `not_found`, a document the ledger cannot read is `not_eligible`. */
export function operationOf(snap: DocumentSnapshot): LedgerTransaction {
  if (!snap.exists) throw new LedgerError('not_found')
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx) throw new LedgerError('not_eligible')
  return tx
}

/** `excluded` of an operation with these tags, from the flags as they are inside this transaction (S10t). */
async function excludedNow(t: Transaction, db: Firestore, orgId: string, tags: readonly string[]): Promise<boolean> {
  const snaps: DocumentSnapshot[] = []
  for (const id of tags) snaps.push(await t.get(tagsCol(db, orgId).doc(id)))
  return excludedFromTags(tags, tagFlagsOf(snaps))
}

/** Every account the operations touch exists with the currency they carry (as `commit` checks); otherwise `conflict`. */
async function assertAccounts(t: Transaction, db: Firestore, orgId: string, txs: readonly LedgerTransaction[]): Promise<void> {
  const want = new Map<string, string>()
  for (const tx of txs) {
    want.set(tx.accountId, tx.currency)
    if (tx.toAccountId !== undefined && tx.toCurrency !== undefined) want.set(tx.toAccountId, tx.toCurrency)
  }
  for (const [id, currency] of want) {
    const snap = await t.get(accountsCol(db, orgId).doc(id))
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!account || account.currency !== currency) throw new LedgerError('conflict')
  }
}

async function targetAccount(t: Transaction, db: Firestore, orgId: string, id: string): Promise<LedgerAccount> {
  const snap = await t.get(accountsCol(db, orgId).doc(id))
  const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
  if (!account) throw new LedgerError('account_not_found', 'toAccountId')
  return account
}

/**
 * Makes a transfer (S10b) in ONE Firestore transaction: the operation(s), the balances and rollups through the change sets
 * (`changeSet`, `combineChanges`), the audit. A conversion turns one bank operation into a transfer with an account that no
 * bank feeds (such an account gets its side from its own bank: merge the two instead). A pair turns a bank expense into a
 * transfer that absorbs the bank income of another account; the income is deleted, its `bankSeen` mark stays (and must
 * exist: it keeps the sync from importing that income again). Every read comes first.
 */
export async function makeTransfer(deps: LedgerDeps, orgId: string, uid: string, job: TransferJob): Promise<MadeTransfer> {
  const { db } = deps
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const baseCurrency = orgSnap.get('currency') as string
    return job.mode === 'convert' ? convertIn(t, deps, orgId, uid, baseCurrency, job) : mergeIn(t, deps, orgId, uid, baseCurrency, job)
  })
}

async function convertIn(
  t: Transaction,
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  baseCurrency: string,
  job: Extract<TransferJob, { mode: 'convert' }>,
): Promise<MadeTransfer> {
  const { db } = deps
  const ref = transactionsCol(db, orgId).doc(job.id)
  const snap = await t.get(ref)
  const prior = operationOf(snap)
  const target = await targetAccount(t, db, orgId, job.toAccountId)
  if (await isLinkedToBank(t, deps, orgId, target.id)) throw new LedgerError('not_eligible', 'toAccountId')
  const built = convertToTransfer(prior, target)
  await assertAccounts(t, db, orgId, [prior, built])
  const next = withExcluded(built, await excludedNow(t, db, orgId, built.tags))

  const ts = Timestamp.fromDate(deps.now())
  applyChange(t, db, orgId, changeSet(prior, next, baseCurrency), ts)
  t.set(ref, storedDoc(next, orgId, uid, ts, snap.data() ?? {}))
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, prior.id, transactionToDoc(prior), transactionToDoc(next), { via: 'transfer' }))
  return { transaction: next, deletedId: null, droppedTags: 0, before: [prior] }
}

async function mergeIn(
  t: Transaction,
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  baseCurrency: string,
  job: Extract<TransferJob, { mode: 'pair' }>,
): Promise<MadeTransfer> {
  const { db } = deps
  const refs = job.ids.map((id) => transactionsCol(db, orgId).doc(id))
  const snaps = [await t.get(refs[0]), await t.get(refs[1])]
  const versions = job.versions
  if (versions) {
    snaps.forEach((snap, i) => {
      if (snap.exists && (!snap.updateTime || !snap.updateTime.isEqual(versions[i]))) throw new LedgerError('conflict')
    })
  }
  const [a, b] = snaps.map(operationOf)
  // The expense is the outgoing side and keeps its id; the income goes into it.
  const first = bankSideOf(a) === 'out'
  const out = first ? a : b
  const inc = first ? b : a
  const outSnap = first ? snaps[0] : snaps[1]
  const incRef = first ? refs[1] : refs[0]
  const { transfer, droppedTags } = mergeToTransfer(out, inc)
  const markSnap = await t.get(orgRef(db, orgId).collection('bankSeen').doc(bankKeyOf(inc.id) as string))
  if (!markSnap.exists) throw new LedgerError('not_eligible')
  await assertAccounts(t, db, orgId, [out, inc, transfer])
  const next = withExcluded(transfer, await excludedNow(t, db, orgId, transfer.tags))

  const ts = Timestamp.fromDate(deps.now())
  applyChange(t, db, orgId, combineChanges(changeSet(out, next, baseCurrency), changeSet(inc, null, baseCurrency)), ts)
  t.set(outSnap.ref, storedDoc(next, orgId, uid, ts, outSnap.data() ?? {}))
  t.delete(incRef)
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, out.id, transactionToDoc(out), transactionToDoc(next), { via: 'transfer' }))
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, inc.id, transactionToDoc(inc), null, { via: 'transfer' }))
  return { transaction: next, deletedId: inc.id, droppedTags: droppedTags.length, before: [out, inc] }
}

export interface SplitResult {
  /** What the transfer was split into: the operation under its id first, then the income re-created under its bank id. */
  restored: LedgerTransaction[]
}

/**
 * Splits a transfer with a bank side back into the bank operations it was (S10b, `splitTransferSides`), in ONE Firestore
 * transaction through the change sets, so no balance moves. A side in another currency than the company's needs its rates
 * again: they are resolved first (network, outside the transaction), and the transaction then requires the transfer to be
 * the version read before (`conflict` otherwise). The re-created income must not exist (`conflict`). Audit: `tx.update` of
 * the transfer and `tx.create` of the income, both `via: 'transfer'`.
 */
export async function splitTransfer(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<SplitResult> {
  const { db } = deps
  const ref = transactionsCol(db, orgId).doc(txId)
  const read = await ref.get()
  if (!read.exists) throw new LedgerError('not_found')
  const prior = parseTransaction(read.id, read.data())
  if (!prior || !read.updateTime) throw new LedgerError('not_eligible')
  const version = read.updateTime
  const org = await orgRef(db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const baseCurrency = org.get('currency') as string
  const sides = splitTransferSides(prior)
  const today = deps.today()
  const withRates = async (tx: LedgerTransaction): Promise<LedgerTransaction> => {
    const plan = fxPlan(tx, baseCurrency, today)
    const snapshots = await Promise.all(plan.map((r) => deps.resolveRate(r.from, r.to, r.date)))
    return attachFx(tx, plan, snapshots.map(evidenceOf))
  }
  const kept = await withRates(sides.kept)
  const recreated = sides.recreated === null ? null : await withRates(sides.recreated)

  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const snap = await t.get(ref)
    const otherRef = recreated === null ? null : transactionsCol(db, orgId).doc(recreated.id)
    const otherSnap = otherRef === null ? null : await t.get(otherRef)
    if (!orgSnap.exists || orgSnap.get('currency') !== baseCurrency) throw new LedgerError('conflict')
    if (!snap.exists) throw new LedgerError('not_found')
    if (!snap.updateTime || !snap.updateTime.isEqual(version)) throw new LedgerError('conflict')
    if (otherSnap?.exists) throw new LedgerError('conflict')
    await assertAccounts(t, db, orgId, recreated === null ? [prior, kept] : [prior, kept, recreated])
    // Both sides keep the transfer's tags: one reading of their flags serves both (S10t).
    const excluded = await excludedNow(t, db, orgId, prior.tags)
    const keptNext = withExcluded(kept, excluded)
    const recreatedNext = recreated === null ? null : withExcluded(recreated, excluded)

    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(prior, keptNext, baseCurrency), changeSet(null, recreatedNext, baseCurrency)), ts)
    t.set(ref, storedDoc(keptNext, orgId, uid, ts, snap.data() ?? {}))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, prior.id, transactionToDoc(prior), transactionToDoc(keptNext), { via: 'transfer' }))
    if (otherRef !== null && recreatedNext !== null) {
      t.create(otherRef, storedDoc(recreatedNext, orgId, uid, ts))
      t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.create', uid, recreatedNext.id, null, transactionToDoc(recreatedNext), { via: 'transfer' }))
    }
    return { restored: recreatedNext === null ? [keptNext] : [keptNext, recreatedNext] }
  })
}
