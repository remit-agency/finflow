import 'server-only'
import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp, type CollectionReference, type DocumentReference, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { footprintOf, splitByWriteBudget } from '@/lib/domain/import/finmap/budget'
import type { BatchOp, FinmapBatchRequest } from '@/lib/domain/import/finmap/request'
import { attachFx, buildTransaction, fxPlan, type FxRequest } from '@/lib/domain/ledger/build'
import { changeSet, combineChanges, type ChangeSet } from '@/lib/domain/ledger/change'
import { parseAccount } from '@/lib/domain/ledger/doc'
import { LedgerError, type LedgerErrorCode } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { excludedFromTags, tagFlagsOf, withExcluded, type TagFlags } from '@/lib/domain/tags/exclude'
import { bankSeenCol } from '@/lib/server/banking/paths'
import { FxError, type RateSnapshot } from '@/lib/server/fx/types'
import { auditData } from '@/lib/server/ledger/audit'
import { assertUnlocked } from '@/lib/server/ledger/lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, tagsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { applyChange, evidenceOf, storedDoc } from '@/lib/server/ledger/write'
import { seenKeysOf } from '../bank-ops'
import type { ImportDeps } from '../deps'
import { ImportError } from '../errors'
import { importLocksCol, importsCol } from '../paths'
import { acquireAll, releaseAll } from '../step'
import { parseImportDoc, type ImportDoc } from '../types'
import { finmapKey, finmapTxId } from './key'

/**
 * Why one operation of a batch was not written: a ledger code (the ledger's own refusal), the batch's duplicate-key rule, or
 * `rate_unavailable` (no NBP rate exists for the operation's day: a permanent answer, unlike a provider outage, which fails the request).
 */
export type BatchRefusalReason = LedgerErrorCode | 'duplicate_key' | 'rate_unavailable'

export interface FinmapBatchRefusal {
  index: number
  reason: BatchRefusalReason
  /** The input field the refusal is about, when there is one. */
  field?: string
}

export interface FinmapBatchResult {
  created: number
  /** Operations whose mark was already there: written before, or by a request that raced this one. */
  skipped: number
  refused: FinmapBatchRefusal[]
}

type Collection = 'accounts' | 'categories' | 'counterparties' | 'tags'

/** What a batch read about the company, with the fingerprint of every document it refers to (`printOf`), by path. */
interface Context {
  baseCurrency: string
  today: string
  accounts: Map<string, LedgerAccount>
  categories: Map<string, 'income' | 'expense'>
  counterparties: Map<string, boolean>
  tags: Map<string, DocumentSnapshot>
  prints: Map<string, string>
}

/** An operation ready to write: its built and FX-resolved document, its change set, and the documents it reads. */
interface Built {
  key: string
  tx: LedgerTransaction
  change: ChangeSet
  /** Write-budget footprint: the `accounts/{id}` and `rollups/{id}` the change touches. */
  docs: string[]
  /** The documents the build read (paths): a transaction that finds one changed is a `conflict`. */
  refs: string[]
}

interface Totals {
  created: number
  skipped: number
  refused: FinmapBatchRefusal[]
  accountIds: Set<string>
  /** The payment days of the operations created: the import's period widens to cover them. */
  days: string[]
}

interface GroupResult {
  created: number
  skipped: number
  accountIds: string[]
  days: string[]
}

const refusal = (index: number, reason: BatchRefusalReason, field?: string): FinmapBatchRefusal =>
  field === undefined ? { index, reason } : { index, reason, field }

/** The key of an operation, rebuilt from its fields on the server (`finmapKey`). */
const keyOf = (o: BatchOp): string => finmapKey(o.accountId, o.toAccountId, o.identity, o.ordinal)

/** The body the ledger's own create takes for the operation: the same fields the one-by-one path sends. */
function bodyOf(o: BatchOp, key: string): Record<string, unknown> {
  return {
    clientId: finmapTxId(key),
    type: o.kind,
    status: o.status,
    accountId: o.accountId,
    amountMinor: o.amountMinor,
    paymentDate: o.day,
    ...(o.toAccountId === null ? {} : { toAccountId: o.toAccountId }),
    ...(o.toAmountMinor === null ? {} : { toAmountMinor: o.toAmountMinor }),
    ...(o.accrual === null ? {} : { accrual: { mode: 'period', from: o.accrual.from, to: o.accrual.to } }),
    ...(o.categoryId === null ? {} : { categoryId: o.categoryId }),
    ...(o.counterpartyId === null ? {} : { counterpartyId: o.counterpartyId }),
    ...(o.description === null ? {} : { description: o.description }),
    tags: o.tagIds,
  }
}

/**
 * Writes a Finmap request's operations (S14b step 6): at most 60 of them, each with its mark `bankSeen/{key}`, in as few
 * Firestore transactions as the write budget needs. A transaction holds its operations, their marks, one combined balance and
 * rollup change (`combineChanges`) and one audit entry; the operations are never created one by one. Reads are batched
 * outside the transactions, and each transaction re-reads what it depends on: a change in between is a `conflict` (the
 * client retries the step once). Operations the ledger refuses come back with its code, they are never thrown. The step
 * locks of the request's accounts are held for the whole run and released in `finally`.
 */
export async function finmapBatch(deps: ImportDeps, orgId: string, uid: string, req: FinmapBatchRequest): Promise<FinmapBatchResult> {
  const importRef = await openFinmapImport(deps, orgId, req.importId)
  const accountIds = [...new Set(req.operations.flatMap((o) => (o.toAccountId === null ? [o.accountId] : [o.accountId, o.toAccountId])))].sort()
  const lockRefs = accountIds.map((id) => importLocksCol(deps.db, orgId).doc(id))
  const token = randomUUID()
  const totals: Totals = { created: 0, skipped: 0, refused: [], accountIds: new Set(), days: [] }
  await acquireAll(deps, lockRefs, token)
  try {
    try {
      await writeAll(deps, orgId, uid, req, totals)
    } finally {
      // Recorded even when a transaction throws: the operations written so far are facts of the import.
      await recordTotals(deps.db, importRef, totals)
    }
  } finally {
    await releaseAll(deps, lockRefs, token)
  }
  return { created: totals.created, skipped: totals.skipped, refused: totals.refused }
}

/** The import the batch belongs to: an applied Finmap import of this company, else `not_found`. */
async function openFinmapImport(deps: ImportDeps, orgId: string, importId: string): Promise<DocumentReference> {
  const ref = importsCol(deps.db, orgId).doc(importId)
  const doc = parseImportDoc((await ref.get()).data())
  if (doc === null || doc.kind !== 'finmap' || doc.status !== 'applied') throw new ImportError('not_found')
  return ref
}

async function writeAll(deps: ImportDeps, orgId: string, uid: string, req: FinmapBatchRequest, totals: Totals): Promise<void> {
  if (req.operations.length === 0) return
  const ctx = await readContext(deps, orgId, req.operations)
  // Nothing is recorded until every rate is known: a request that fails on the provider writes nothing and counts nothing.
  const prepared = await buildOperations(deps, orgId, req, ctx)
  totals.skipped += prepared.skipped
  totals.refused.push(...prepared.refused)
  const built = prepared.built
  for (const group of splitByWriteBudget(built.map((b) => ({ docs: b.docs })))) {
    const r = await writeGroup(deps, orgId, uid, ctx, req.importId, group.map((i) => built[i]))
    totals.created += r.created
    totals.skipped += r.skipped
    for (const id of r.accountIds) totals.accountIds.add(id)
    totals.days.push(...r.days)
  }
}

/** One `getAll` per collection: the accounts, categories, counterparties and tags the request names. */
async function readContext(deps: ImportDeps, orgId: string, ops: readonly BatchOp[]): Promise<Context> {
  const { db } = deps
  const org = await orgRef(db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const ids = (pick: (o: BatchOp) => Array<string | null>): string[] => [...new Set(ops.flatMap(pick).filter((x): x is string => x !== null))]
  const [accountSnaps, categorySnaps, counterpartySnaps, tagSnaps] = await Promise.all([
    readAll(db, accountsCol(db, orgId), ids((o) => [o.accountId, o.toAccountId])),
    readAll(db, categoriesCol(db, orgId), ids((o) => [o.categoryId])),
    readAll(db, counterpartiesCol(db, orgId), ids((o) => [o.counterpartyId])),
    readAll(db, tagsCol(db, orgId), ids((o) => o.tagIds)),
  ])

  const ctx: Context = {
    baseCurrency: org.get('currency') as string,
    today: deps.today(),
    accounts: new Map(),
    categories: new Map(),
    counterparties: new Map(),
    tags: new Map(),
    prints: new Map(),
  }
  for (const s of accountSnaps) {
    const account = parseAccount(s.id, s.data())
    if (account) ctx.accounts.set(s.id, account)
    ctx.prints.set(`accounts/${s.id}`, printOf('accounts', s))
  }
  for (const s of categorySnaps) {
    const type = s.get('type')
    if (s.exists && (type === 'income' || type === 'expense')) ctx.categories.set(s.id, type)
    ctx.prints.set(`categories/${s.id}`, printOf('categories', s))
  }
  for (const s of counterpartySnaps) {
    if (s.exists) ctx.counterparties.set(s.id, s.get('archived') === true)
    ctx.prints.set(`counterparties/${s.id}`, printOf('counterparties', s))
  }
  for (const s of tagSnaps) {
    ctx.tags.set(s.id, s)
    ctx.prints.set(`tags/${s.id}`, printOf('tags', s))
  }
  return ctx
}

async function readAll(db: Firestore, col: CollectionReference, ids: readonly string[]): Promise<DocumentSnapshot[]> {
  if (ids.length === 0) return []
  return db.getAll(...ids.map((id) => col.doc(id)))
}

/**
 * What a transaction must find again for a document the batch read: an account's currency, a category's type, whether a
 * counterparty is archived, and whether a tag exists, is archived or excludes from analytics. `missing` when it is gone.
 */
function printOf(collection: Collection, s: DocumentSnapshot): string {
  if (!s.exists) return 'missing'
  if (collection === 'accounts') return `currency:${String(s.get('currency'))}`
  if (collection === 'categories') return `type:${String(s.get('type'))}`
  if (collection === 'counterparties') return `archived:${s.get('archived') === true}`
  return `archived:${s.get('archived') === true}|excluded:${s.get('excludeFromAnalytics') === true}`
}

/**
 * Keeps the operations that can be written: skips those already marked (one read for the request), refuses those the
 * company or the ledger refuses (with the code), and builds the rest with their rates and their `excluded` flag. A rate
 * the provider could not give for a transient reason throws (the request fails, nothing is written); a day with no rate
 * refuses its operation as `rate_unavailable`.
 */
async function buildOperations(
  deps: ImportDeps,
  orgId: string,
  req: FinmapBatchRequest,
  ctx: Context,
): Promise<{ built: Built[]; refused: FinmapBatchRefusal[]; skipped: number }> {
  let skipped = 0
  const refused: FinmapBatchRefusal[] = []
  const keys = req.operations.map(keyOf)
  const marked = await seenKeysOf(deps.db, orgId, keys)
  const flags = tagFlagsOf([...ctx.tags.values()])
  // One rate per distinct (from, to, date) in the request, fetched outside the transactions.
  const rates = new Map<string, Promise<RateSnapshot>>()
  const rateOf = (from: string, to: string, date: string): Promise<RateSnapshot> => {
    const k = `${from}|${to}|${date}`
    let p = rates.get(k)
    if (p === undefined) {
      p = deps.ledger.resolveRate(from, to, date)
      rates.set(k, p)
    }
    return p
  }

  const built: Built[] = []
  const seen = new Set<string>()
  for (let i = 0; i < req.operations.length; i++) {
    const key = keys[i]
    if (seen.has(key)) {
      refused.push(refusal(i, 'duplicate_key'))
      continue
    }
    seen.add(key)
    if (marked.has(key)) {
      skipped++
      continue
    }
    const outcome = await buildOne(ctx, req.operations[i], i, key, req.importId, flags, rateOf)
    if ('reason' in outcome) refused.push(outcome)
    else built.push(outcome)
  }
  return { built, refused, skipped }
}

/** One operation: the company's own refusals first, then the ledger's build (its refusals come back with their code). */
async function buildOne(
  ctx: Context,
  o: BatchOp,
  index: number,
  key: string,
  importId: string,
  flags: Map<string, TagFlags>,
  rateOf: (from: string, to: string, date: string) => Promise<RateSnapshot>,
): Promise<Built | FinmapBatchRefusal> {
  const account = ctx.accounts.get(o.accountId)
  if (!account) return refusal(index, 'account_not_found', 'accountId')
  const toAccount = o.toAccountId === null ? undefined : ctx.accounts.get(o.toAccountId)
  if (o.toAccountId !== null && !toAccount) return refusal(index, 'account_not_found', 'toAccountId')
  if (o.counterpartyId !== null) {
    const archived = ctx.counterparties.get(o.counterpartyId)
    if (archived === undefined) return refusal(index, 'counterparty_not_found', 'counterpartyId')
    if (archived) return refusal(index, 'counterparty_archived', 'counterpartyId')
  }
  for (const id of o.tagIds) {
    const tag = ctx.tags.get(id)
    if (!tag?.exists) return refusal(index, 'tag_not_found', 'tags')
    if (tag.get('archived') === true) return refusal(index, 'tag_archived', 'tags')
  }
  const categoryType = o.categoryId === null ? undefined : ctx.categories.get(o.categoryId)
  const category = categoryType === undefined ? null : { type: categoryType }

  let base: LedgerTransaction
  let plan: FxRequest[]
  try {
    const input = parseTransactionInput(bodyOf(o, key), { internal: true })
    base = buildTransaction(finmapTxId(key), input, { today: ctx.today, account, toAccount, category, baseCurrency: ctx.baseCurrency })
    plan = fxPlan(base, ctx.baseCurrency, ctx.today)
  } catch (e) {
    if (e instanceof LedgerError) return refusal(index, e.code, e.field)
    throw e
  }
  let evidence: RateSnapshot[]
  try {
    evidence = await Promise.all(plan.map((r) => rateOf(r.from, r.to, r.date)))
  } catch (e) {
    // A provider outage is the request's failure (retryable, the caller sends it again); a permanent answer refuses this operation.
    if (!(e instanceof FxError) || e.code === 'provider_unavailable') throw e
    return refusal(index, e.code === 'invalid_params' ? 'invalid_input' : 'rate_unavailable', 'paymentDate')
  }
  const tx: LedgerTransaction = { ...withExcluded(attachFx(base, plan, evidence.map(evidenceOf)), excludedFromTags(o.tagIds, flags)), importId }

  const change = changeSet(null, tx, ctx.baseCurrency)
  const docs = footprintOf(change)
  const refs = [
    `accounts/${o.accountId}`,
    ...(o.toAccountId === null ? [] : [`accounts/${o.toAccountId}`]),
    ...(o.categoryId === null ? [] : [`categories/${o.categoryId}`]),
    ...(o.counterpartyId === null ? [] : [`counterparties/${o.counterpartyId}`]),
    ...o.tagIds.map((id) => `tags/${id}`),
  ]
  return { key, tx, change, docs, refs }
}

/**
 * One Firestore transaction for a group: the ledger lock, the company's currency and the documents the group read (any change
 * is a `conflict`), the marks (an operation marked meanwhile is skipped), one combined change, the operations with their marks,
 * and one audit entry. A document already there where an operation is created is a `conflict` as well.
 */
async function writeGroup(deps: ImportDeps, orgId: string, uid: string, ctx: Context, importId: string, group: Built[]): Promise<GroupResult> {
  const { db } = deps
  const refs = [...new Set(group.flatMap((b) => b.refs))]
  try {
    return await db.runTransaction(async (t): Promise<GroupResult> => {
      await assertUnlocked(t, deps.ledger, orgId)
      const orgSnap = await t.get(orgRef(db, orgId))
      if (!orgSnap.exists || orgSnap.get('currency') !== ctx.baseCurrency) throw new LedgerError('conflict')
      const reads = refs.length === 0 ? [] : await t.getAll(...refs.map((p) => db.doc(`organizations/${orgId}/${p}`)))
      refs.forEach((path, i) => {
        const collection = path.split('/')[0] as Collection
        if (printOf(collection, reads[i]) !== ctx.prints.get(path)) throw new LedgerError('conflict')
      })
      const marks = await t.getAll(...group.map((b) => bankSeenCol(db, orgId).doc(b.key)))
      const fresh = group.filter((_, i) => !marks[i].exists)
      const skipped = group.length - fresh.length
      if (fresh.length === 0) return { created: 0, skipped, accountIds: [], days: [] }

      const ts = Timestamp.fromDate(deps.now())
      applyChange(t, db, orgId, combineChanges(...fresh.map((b) => b.change)), ts)
      for (const b of fresh) {
        t.create(transactionsCol(db, orgId).doc(b.tx.id), storedDoc(b.tx, orgId, uid, ts))
        t.create(bankSeenCol(db, orgId).doc(b.key), {
          txId: b.tx.id,
          at: deps.now().toISOString(),
          importId,
          kind: 'finmap',
          snapshot: { type: b.tx.type, accountId: b.tx.accountId, amountMinor: b.tx.amountMinor, paymentDate: b.tx.paymentDate },
        })
      }
      t.create(auditCol(db, orgId).doc(), auditData(deps, 'import.batch', uid, importId, null, { importId, created: fresh.length }, { via: 'import' }))
      const accountIds = [...new Set(fresh.flatMap((b) => [b.tx.accountId, ...(b.tx.toAccountId === undefined ? [] : [b.tx.toAccountId])]))]
      return { created: fresh.length, skipped, accountIds, days: fresh.map((b) => b.tx.paymentDate) }
    })
  } catch (e) {
    if (isAlreadyExists(e)) throw new LedgerError('conflict')
    throw e
  }
}

/** Firestore's ALREADY_EXISTS (a create of an operation that is there by now). */
function isAlreadyExists(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return code === 6 || code === 'already-exists'
}

/**
 * The batch's totals on the import document, also when a transaction failed (what was written is a fact of the import). One
 * transaction reads the document and widens its period (`null` at first) to the days created, so two batches racing on one
 * import cannot lose a day; the counts are increments.
 */
async function recordTotals(db: Firestore, ref: DocumentReference, totals: Totals): Promise<void> {
  if (totals.created === 0 && totals.skipped === 0 && totals.refused.length === 0) return
  await db.runTransaction(async (t) => {
    const doc = parseImportDoc((await t.get(ref)).data())
    const update: Record<string, unknown> = {
      'counts.created': FieldValue.increment(totals.created),
      'counts.skipped': FieldValue.increment(totals.skipped),
      'counts.refused': FieldValue.increment(totals.refused.length),
    }
    if (totals.accountIds.size > 0) update.accountIds = FieldValue.arrayUnion(...Array.from(totals.accountIds))
    if (doc !== null && totals.days.length > 0) update.period = widenPeriod(doc.period, totals.days)
    t.update(ref, update)
  })
}

/** The period widened to the earliest and latest of the days (YYYY-MM-DD compares as text). */
function widenPeriod(period: ImportDoc['period'], days: readonly string[]): ImportDoc['period'] {
  let from = period.from
  let to = period.to
  for (const d of days) {
    if (from === null || d < from) from = d
    if (to === null || d > to) to = d
  }
  return { from, to }
}
