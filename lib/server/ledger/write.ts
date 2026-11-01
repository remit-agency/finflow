import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { assertBankUnlocked, withBankSides } from '@/lib/domain/ledger/bank-lock'
import { changeSet, type ChangeSet } from '@/lib/domain/ledger/change'
import { parseAccount, parseBankInfo, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { applyPatch, BANK_CLIENT_ID_PREFIX, toRawInput, type TransactionInput, type TransactionPatch } from '@/lib/domain/ledger/input'
import { nest } from '@/lib/domain/ledger/rollups'
import type { AutoRuleRef, BankInfo, BankToInfo, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'
import { mergeTags, sameTags, type TagChange } from '@/lib/domain/tags/assign'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import type { RateSnapshot } from '@/lib/server/fx/types'
import { auditData, type AuditAction } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, rollupsCol, tagsCol, transactionsCol } from './paths'

export interface WriteResult {
  transaction: LedgerTransaction
  /** True when a create with an already used clientId returned the existing operation. */
  replayed: boolean
}

/**
 * What only server code may add to a write, never a request body (S10).
 * - `autoRules`: the rules that filled the category or the counterparty. The operation keeps them as its trace and the
 *   audit entry says `via: 'rule'`.
 * - `expectVersion` (update only): the write is refused with `conflict` unless the stored operation is still that version,
 *   so a rule never replaces what a person chose after the rules read the operation.
 * - `restore` (update only): the write puts a previous state back (the undo of an edit or a bulk change). A tag of that
 *   state that is archived by now is accepted, as long as it exists. The PATCH route sets it only from the `restore=1`
 *   query marker (`parseRestoreMarker`), never from the body; an ordinary write keeps refusing archived tags.
 */
export interface WriteExtras {
  autoRules?: AutoRuleRef[]
  expectVersion?: Timestamp
  restore?: boolean
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
  /** Set when the rules made the change (S10): the audit entry records it. */
  via?: 'rule'
  /** Set when the write restores a previous state (WriteExtras.restore): archived tags of the new state are accepted. */
  restore?: boolean
}

export function evidenceOf(s: RateSnapshot): RateEvidence {
  // Only final snapshots may be stored for good (S04). The plan never asks for a date after today.
  if (!s.final) throw new Error('refusing to store a non-final rate snapshot')
  return { rate: s.rate, from: s.from, to: s.to, requestedDate: s.requestedDate, rateDate: s.rateDate, tableNo: s.tableNo, source: s.source }
}

/** Writes the balance and rollup increments of a change set inside `t` (S05: the single write rule, `changeSet`). */
export function applyChange(t: Transaction, db: Firestore, orgId: string, change: ChangeSet, ts: Timestamp): void {
  for (const [id, delta] of Object.entries(change.balanceDeltas)) {
    t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
  }
  for (const [id, flat] of change.rollupDeltas) {
    t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
  }
}

/**
 * The stored document of an operation: its fields plus the server's bookkeeping. `old` is the stored data of the operation
 * it replaces (absent for a new one): its creation stamp and the S05 migration provenance outlive every edit.
 */
export function storedDoc(next: LedgerTransaction, orgId: string, uid: string, ts: Timestamp, old?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...transactionToDoc(next),
    ...(old && old.migratedFrom !== undefined ? { migratedFrom: old.migratedFrom } : {}),
    ...(old && old.legacy !== undefined ? { legacy: old.legacy } : {}),
    orgId,
    createdAt: old ? (old.createdAt ?? ts) : ts,
    createdBy: old ? (old.createdBy ?? uid) : uid,
    updatedAt: ts,
    updatedBy: uid,
  }
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
    // Tags (S10t): every tag of the new state is read, so `excluded` follows the flags as they are inside this
    // transaction. Only a tag this write newly gives the operation is checked: an edit of something else, or taking an
    // archived tag off, never fails because of a tag.
    const nextTags = job.next?.tx.tags ?? []
    const tagSnaps: DocumentSnapshot[] = []
    for (const id of nextTags) tagSnaps.push(await t.get(tagsCol(db, orgId).doc(id)))

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
    const priorTags = job.prior?.tx.tags ?? []
    tagSnaps.forEach((snap, i) => {
      if (priorTags.includes(nextTags[i])) return
      if (!snap.exists) throw new LedgerError('tag_not_found', 'tags')
      if (snap.get('archived') === true && job.restore !== true) throw new LedgerError('tag_archived', 'tags')
    })

    // ---- writes ----
    const ts = Timestamp.fromDate(deps.now())
    // `excluded` is the ledger's own field: decided here from the tags read above, never taken from a request.
    const next = job.next ? withExcluded(job.next.tx, excludedFromTags(nextTags, tagFlagsOf(tagSnaps))) : null
    const change = changeSet(job.prior?.tx ?? null, next, baseCurrency)

    applyChange(t, db, orgId, change, ts)

    if (next) {
      t.set(txRef, storedDoc(next, orgId, uid, ts, job.prior ? (currentSnap.data() ?? {}) : undefined))
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
        next ? transactionToDoc(next) : null,
        job.via === undefined ? undefined : { via: job.via },
      ),
    )

    return { transaction: next ?? (job.prior as NonNullable<typeof job.prior>).tx, replayed: false }
  })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The bank blocks a create under a bank id takes from the bank's own marks (S09; transfers S10b). */
interface BankSides {
  bank?: BankInfo
  bankTo?: BankToInfo
}

function refuseBankId(): never {
  throw new LedgerError('invalid_input', 'clientId')
}

/** The bank's mark of one imported operation: its bank block and the locked fields of the import; null without them (a failed import). */
async function readMark(deps: LedgerDeps, orgId: string, key: string): Promise<{ bank: BankInfo; snapshot: Record<string, unknown> } | null> {
  const snap = await orgRef(deps.db, orgId).collection('bankSeen').doc(key).get()
  const mark = snap.exists ? snap.data() : undefined
  const bank = parseBankInfo(mark?.bank)
  return bank !== null && isRecord(mark?.snapshot) ? { bank, snapshot: mark.snapshot } : null
}

/** The import a mark records was this one: type, account, amount and payment day. */
function imported(s: Record<string, unknown>, type: string, accountId: string, amountMinor: number, paymentDate: string): boolean {
  return s.type === type && s.accountId === accountId && s.amountMinor === amountMinor && s.paymentDate === paymentDate
}

/**
 * A bank side about to come back must not live on already (S10b): neither as its own operation nor as the incoming side of
 * another transfer. `selfId` is the operation being created; it may hold the key itself (a replay of the same create,
 * which `commit` answers with the stored operation).
 */
async function assertSideFree(deps: LedgerDeps, orgId: string, key: string, selfId: string): Promise<void> {
  const ownId = `${BANK_CLIENT_ID_PREFIX}${key}`
  if (ownId !== selfId && (await transactionsCol(deps.db, orgId).doc(ownId).get()).exists) refuseBankId()
  const holders = await transactionsCol(deps.db, orgId).where('bankTo.key', '==', key).limit(2).get()
  if (holders.docs.some((d) => d.id !== selfId)) refuseBankId()
}

/**
 * The provenance of a create whose id is a bank operation id (`bk_` + key). Only the bank's own marks (`bankSeen/{key}`,
 * written by the sync at import) can say what the operation was: the create must repeat the locked fields of that import
 * and be an actual operation, otherwise it is refused (`invalid_input` on `clientId`). This is how an undo of a deleted bank
 * operation comes back with its bank block, and how a client cannot make one. A transfer (S10b) comes back the same way:
 * its outgoing side is the expense its own id was imported as, its incoming side the income of `bankToKey` on
 * `toAccountId` with `toAmountMinor` on `toDate ?? paymentDate` (a deposit, whose only bank side is the incoming one, is the
 * income its own id was imported as). A side that lives on already is refused, so nothing counts a bank operation twice.
 * Ids without the prefix return undefined (an ordinary create).
 */
async function bankSidesOf(deps: LedgerDeps, orgId: string, input: TransactionInput): Promise<BankSides | undefined> {
  const clientId = input.clientId
  if (clientId === undefined || !clientId.startsWith(BANK_CLIENT_ID_PREFIX)) return undefined
  if (input.status !== 'actual') refuseBankId()
  const key = clientId.slice(BANK_CLIENT_ID_PREFIX.length)
  const own = await readMark(deps, orgId, key)
  if (own === null) refuseBankId()
  if (input.type !== 'transfer') {
    if (!imported(own.snapshot, input.type, input.accountId, input.amountMinor, input.paymentDate)) refuseBankId()
    await assertSideFree(deps, orgId, key, clientId)
    return { bank: own.bank }
  }
  const toAccountId = input.toAccountId as string
  // Between accounts of one currency the amount that arrives is the amount itself (buildTransaction).
  const toAmountMinor = input.toAmountMinor ?? input.amountMinor
  if (imported(own.snapshot, 'expense', input.accountId, input.amountMinor, input.paymentDate)) {
    if (input.bankToKey === undefined) return { bank: own.bank }
    const other = await readMark(deps, orgId, input.bankToKey)
    if (other === null || !imported(other.snapshot, 'income', toAccountId, toAmountMinor, input.toDate ?? input.paymentDate)) refuseBankId()
    await assertSideFree(deps, orgId, input.bankToKey, clientId)
    return { bank: own.bank, bankTo: { key: input.bankToKey, ...other.bank } }
  }
  if (input.bankToKey !== undefined || !imported(own.snapshot, 'income', toAccountId, toAmountMinor, input.paymentDate)) refuseBankId()
  await assertSideFree(deps, orgId, key, clientId)
  return { bankTo: { key, ...own.bank } }
}

export async function createTransaction(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  input: TransactionInput,
  bank?: BankInfo,
  extras: WriteExtras = {},
): Promise<WriteResult> {
  const txId = input.clientId ?? transactionsCol(deps.db, orgId).doc().id
  const sides = bank !== undefined ? { bank } : await bankSidesOf(deps, orgId, input)
  const next = await prepare(deps, orgId, txId, input)
  if (sides !== undefined) next.tx = { ...next.tx, ...sides }
  const autoRules = extras.autoRules ?? []
  if (autoRules.length > 0) next.tx = { ...next.tx, autoRules: autoRules.map((r) => ({ id: r.id, name: r.name })) }
  return commit(deps, orgId, uid, { action: 'tx.create', txId, prior: null, next, via: autoRules.length > 0 ? 'rule' : undefined })
}

async function loadPrior(deps: LedgerDeps, orgId: string, txId: string) {
  const snap = await transactionsCol(deps.db, orgId).doc(txId).get()
  if (!snap.exists) throw new LedgerError('not_found')
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx || !snap.updateTime) throw new LedgerError('conflict')
  return { tx, version: snap.updateTime }
}

/**
 * The trace an update leaves (S10). A write by the rules adds its rules to the trace (each once). Otherwise a change of
 * the category or the counterparty is a person's choice and removes the trace; any other edit keeps it.
 */
function autoRulesAfter(prior: LedgerTransaction, next: LedgerTransaction, given: readonly AutoRuleRef[]): AutoRuleRef[] | undefined {
  if (given.length > 0) {
    const merged = [...(prior.autoRules ?? [])]
    for (const r of given) if (!merged.some((m) => m.id === r.id)) merged.push({ id: r.id, name: r.name })
    return merged
  }
  if (prior.categoryId !== next.categoryId || prior.counterpartyId !== next.counterpartyId) return undefined
  return prior.autoRules
}

export async function updateTransaction(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  txId: string,
  patch: TransactionPatch,
  extras: WriteExtras = {},
): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  // The rules read the operation at `expectVersion`: anything a person did since then wins (S10).
  if (extras.expectVersion !== undefined && !prior.version.isEqual(extras.expectVersion)) throw new LedgerError('conflict')
  const next = await prepare(deps, orgId, txId, applyPatch(toRawInput(prior.tx), patch))
  if (prior.tx.bank !== undefined || prior.tx.bankTo !== undefined) {
    // toRawInput never carries the bank blocks or the arrival day (S10b): an edit keeps them from the prior document, and
    // the lock compares what each bank side fixes.
    const carried = withBankSides(next.tx, prior.tx)
    assertBankUnlocked(prior.tx, carried)
    next.tx = carried
  }
  const given = extras.autoRules ?? []
  // toRawInput never carries `autoRules` either: the trace is decided here.
  const autoRules = autoRulesAfter(prior.tx, next.tx, given)
  if (autoRules !== undefined) next.tx = { ...next.tx, autoRules }
  return commit(deps, orgId, uid, {
    action: 'tx.update',
    txId,
    prior,
    next,
    via: given.length > 0 ? 'rule' : undefined,
    restore: extras.restore === true,
  })
}

export async function deleteTransaction(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  return commit(deps, orgId, uid, { action: 'tx.delete', txId, prior, next: null })
}

/**
 * Adds and takes off tags (the bulk change of the journal, S10t). The new list comes from the operation as it is stored
 * (`mergeTags`: takes off first, then adds while there are fewer than 10) and goes through `updateTransaction` with the
 * version read here, so a change made in between is a `conflict`, never lost. A list that stays the same writes nothing.
 */
export async function retagTransaction(deps: LedgerDeps, orgId: string, uid: string, txId: string, change: TagChange): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  const tags = mergeTags(prior.tx.tags, change.add, change.remove)
  if (sameTags(tags, prior.tx.tags)) return { transaction: prior.tx, replayed: false }
  return updateTransaction(deps, orgId, uid, txId, { tags }, { expectVersion: prior.version })
}

/**
 * Brings the stored `excluded` of one operation in line with its tags as they are now (S10t: a tag's flag changed after
 * the operation was written). One Firestore transaction through `changeSet`: only the rollups move (the balances never
 * depend on the flag), the operation keeps everything else, and the audit entry says `via: 'tag'`. False, writing
 * nothing, when the operation is gone, is not a ledger v2 document or already agrees.
 */
export async function refreshExcluded(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<boolean> {
  const { db } = deps
  const txRef = transactionsCol(db, orgId).doc(txId)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const snap = await t.get(txRef)
    const prior = snap.exists ? parseTransaction(snap.id, snap.data()) : null
    if (!orgSnap.exists || prior === null) return false
    const tagSnaps: DocumentSnapshot[] = []
    for (const id of prior.tags) tagSnaps.push(await t.get(tagsCol(db, orgId).doc(id)))
    const excluded = excludedFromTags(prior.tags, tagFlagsOf(tagSnaps))
    if (excluded === (prior.excluded === true)) return false

    const next = withExcluded(prior, excluded)
    const change = changeSet(prior, next, orgSnap.get('currency') as string)
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, change, ts)
    t.update(txRef, { excluded: excluded ? true : FieldValue.delete(), updatedAt: ts, updatedBy: uid })
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, txId, transactionToDoc(prior), transactionToDoc(next), { via: 'tag' }))
    return true
  })
}
