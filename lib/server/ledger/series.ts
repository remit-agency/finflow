import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'
import { nameKey } from '@/lib/domain/counterparties/normalize'
import { systemCounterparty } from '@/lib/domain/counterparties/system'
import { buildTransaction } from '@/lib/domain/ledger/build'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { addDays } from '@/lib/domain/ledger/days'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { parseDone, parseSeries, seriesToDoc } from '@/lib/domain/recurring/doc'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { applySeriesPatch, assertSeriesHorizon, seriesFromInput, type SeriesInput, type SeriesPatch } from '@/lib/domain/recurring/input'
import { fillPlan, planId, planInputOf, rewriteOccurrences, rewriteState, seriesFieldsOf, type UsableRefs } from '@/lib/domain/recurring/plan'
import { presetCounterparty } from '@/lib/domain/recurring/presets'
import { periodOf, periodStart } from '@/lib/domain/recurring/schedule'
import { MARKS_SCAN, MAX_SERIES, MAX_SHIFT_DAYS, RECURRING_UID, REWRITE_CAP, type FutureMode, type Preset, type Series } from '@/lib/domain/recurring/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, counterpartyKeysCol, orgRef, recurringCol, recurringDoneCol, tagsCol, transactionsCol } from './paths'
import { applyChange, storedDoc } from './write'

/** The operations of a series from `day` on, by payment day (index `transactions (seriesId ASC, paymentDate ASC)`). */
export function seriesOpsQuery(db: Firestore, orgId: string, seriesId: string, day: string) {
  return transactionsCol(db, orgId).where('seriesId', '==', seriesId).where('paymentDate', '>=', day).orderBy('paymentDate')
}

/** The marks of a series from occurrence `day` on (index `recurringDone (seriesId ASC, occurrence ASC)`). */
export function seriesMarksQuery(db: Firestore, orgId: string, seriesId: string, day: string) {
  return recurringDoneCol(db, orgId).where('seriesId', '==', seriesId).where('occurrence', '>=', day).orderBy('occurrence')
}

async function readAll(t: Transaction, refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
  return refs.length === 0 ? [] : t.getAll(...refs)
}

/** Which references a write gives anew (then an unusable one is refused); the others are only left out of the plans. */
interface Strict {
  category: boolean
  counterparty: boolean
  tags: readonly string[]
}
const NOT_STRICT: Strict = { category: false, counterparty: false, tags: [] }

interface PlanContext {
  baseCurrency: string
  account: LedgerAccount
  usable: UsableRefs
  /** `excluded` of a plan with the usable tags (S10t). */
  excluded: boolean
}

/**
 * Reads what the plans of a series depend on, inside the transaction: the company, the account (a plan needs it, so a
 * missing one is `account_not_found`), the category, the counterparty and the tags. A reference the write gives anew must
 * be usable (`category_not_found`, `counterparty_not_found`, `counterparty_archived`, `tag_not_found`, `tag_archived`);
 * an unchanged one that is gone or archived is left out of the plans. `knownCounterparty`: created by this transaction.
 */
async function readContext(t: Transaction, db: Firestore, orgId: string, s: Series, strict: Strict, knownCounterparty = false): Promise<PlanContext> {
  const orgSnap = await t.get(orgRef(db, orgId))
  const accountSnap = await t.get(accountsCol(db, orgId).doc(s.accountId))
  const categorySnap = s.categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(s.categoryId))
  const counterpartySnap = s.counterpartyId === undefined || knownCounterparty ? null : await t.get(counterpartiesCol(db, orgId).doc(s.counterpartyId))
  const tagSnaps: DocumentSnapshot[] = []
  for (const id of s.tags) tagSnaps.push(await t.get(tagsCol(db, orgId).doc(id)))

  if (!orgSnap.exists) throw new RecurringError('not_found')
  const account = accountSnap.exists ? parseAccount(accountSnap.id, accountSnap.data()) : null
  if (account === null) throw new LedgerError('account_not_found', 'accountId')
  const usable: UsableRefs = { tags: [] }
  if (categorySnap !== null) {
    if (categorySnap.exists && categorySnap.get('type') === s.kind) usable.categoryId = s.categoryId
    else if (strict.category) throw new LedgerError('category_not_found', 'categoryId')
  }
  if (s.counterpartyId !== undefined) {
    if (knownCounterparty || (counterpartySnap?.exists && counterpartySnap.get('archived') !== true)) usable.counterpartyId = s.counterpartyId
    else if (strict.counterparty) throw new LedgerError(counterpartySnap?.exists ? 'counterparty_archived' : 'counterparty_not_found', 'counterpartyId')
  }
  tagSnaps.forEach((snap, i) => {
    if (snap.exists && snap.get('archived') !== true) usable.tags.push(s.tags[i])
    else if (strict.tags.includes(s.tags[i])) throw new LedgerError(snap.exists ? 'tag_archived' : 'tag_not_found', 'tags')
  })
  return { baseCurrency: orgSnap.get('currency') as string, account, usable, excluded: excludedFromTags(usable.tags, tagFlagsOf(tagSnaps)) }
}

/** The planned operation of one occurrence, built by the ledger's own rule (`buildTransaction`) plus its series fields. */
function buildPlan(s: Series, occurrence: string, ctx: PlanContext, today: string): LedgerTransaction {
  const input = planInputOf(s, occurrence, ctx.usable)
  const built = buildTransaction(input.clientId as string, input, {
    today,
    account: ctx.account,
    category: ctx.usable.categoryId === undefined ? null : { type: s.kind },
    baseCurrency: ctx.baseCurrency,
  })
  return withExcluded({ ...built, ...seriesFieldsOf(s, occurrence) }, ctx.excluded)
}

function sameDoc(a: LedgerTransaction, b: LedgerTransaction): boolean {
  return JSON.stringify(transactionToDoc(a)) === JSON.stringify(transactionToDoc(b))
}

interface PlanWrites {
  creates: LedgerTransaction[]
  updates: Array<{ prior: LedgerTransaction; next: LedgerTransaction; old: Record<string, unknown> }>
  deletes: LedgerTransaction[]
}

/** The plans' writes of one transaction: the change sets (empty for plans, kept as the single rule), the documents, the audit. */
function writePlans(t: Transaction, deps: LedgerDeps, orgId: string, uid: string, w: PlanWrites, baseCurrency: string, ts: Timestamp): void {
  const { db } = deps
  applyChange(
    t,
    db,
    orgId,
    combineChanges(
      ...w.creates.map((c) => changeSet(null, c, baseCurrency)),
      ...w.updates.map((u) => changeSet(u.prior, u.next, baseCurrency)),
      ...w.deletes.map((d) => changeSet(d, null, baseCurrency)),
    ),
    ts,
  )
  const audit = (action: 'tx.create' | 'tx.update' | 'tx.delete', id: string, before: unknown, after: unknown) =>
    t.create(auditCol(db, orgId).doc(), auditData(deps, action, uid, id, before, after, { via: 'plan' }))
  for (const c of w.creates) {
    t.create(transactionsCol(db, orgId).doc(c.id), storedDoc(c, orgId, uid, ts))
    audit('tx.create', c.id, null, transactionToDoc(c))
  }
  for (const u of w.updates) {
    t.set(transactionsCol(db, orgId).doc(u.next.id), storedDoc(u.next, orgId, uid, ts, u.old))
    audit('tx.update', u.next.id, transactionToDoc(u.prior), transactionToDoc(u.next))
  }
  for (const d of w.deletes) {
    t.delete(transactionsCol(db, orgId).doc(d.id))
    audit('tx.delete', d.id, transactionToDoc(d), null)
  }
}

function withState(s: Series, state: { generatedThrough?: string; dueOn?: string }): Series {
  const out: Series = { ...s }
  delete out.generatedThrough
  delete out.dueOn
  if (state.generatedThrough !== undefined) out.generatedThrough = state.generatedThrough
  if (state.dueOn !== undefined) out.dueOn = state.dueOn
  return out
}

/** The stored series: its fields plus the bookkeeping; `version` counts the people's changes. */
function storedSeries(s: Series, orgId: string, uid: string, ts: Timestamp, old?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...seriesToDoc(s),
    orgId,
    createdAt: old?.createdAt ?? ts,
    createdBy: old?.createdBy ?? uid,
    updatedAt: ts,
    updatedBy: uid,
    version: typeof old?.version === 'number' ? old.version + 1 : 1,
  }
}

interface PresetCounterparty {
  id: string
  /** The company has neither the system record nor a record with its name: this transaction creates it. */
  create: boolean
}

/** The counterparty of a preset (S06 system record): by its fixed id, else the record that owns its name, else a new one. */
async function presetCounterpartyIn(t: Transaction, db: Firestore, orgId: string, preset: Preset): Promise<PresetCounterparty> {
  const spec = presetCounterparty(preset)
  const own = await t.get(counterpartiesCol(db, orgId).doc(spec.id))
  if (own.exists) return { id: spec.id, create: false }
  const key = await t.get(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)))
  const holder: unknown = key.exists ? key.get('counterpartyId') : undefined
  if (typeof holder === 'string') return { id: holder, create: false }
  return { id: spec.id, create: true }
}

/** Creates the S06 system record of a preset with its name key and audit entry (as `seedExistingOrg` does). */
function writeSystemCounterparty(t: Transaction, deps: LedgerDeps, orgId: string, uid: string, preset: Preset, ts: Timestamp): void {
  const spec = presetCounterparty(preset)
  const c = systemCounterparty(spec)
  t.create(counterpartiesCol(deps.db, orgId).doc(spec.id), { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
  t.create(counterpartyKeysCol(deps.db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
  t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.create', uid, spec.id, null, counterpartyToDoc(c)))
}

export interface CreatedSeries {
  series: Series
  created: number
}

/**
 * A new series (S11) in ONE transaction: the limit, the references, the series document, the plans of its first fill
 * (from today to three months ahead) and the audit entries. A preset without a counterparty takes the S06 system record.
 */
export async function createSeries(deps: LedgerDeps, orgId: string, uid: string, input: SeriesInput, opts: { maxCount?: number } = {}): Promise<CreatedSeries> {
  const { db } = deps
  const today = deps.today()
  assertSeriesHorizon(input, today)
  const ref = recurringCol(db, orgId).doc()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const count = (await t.get(recurringCol(db, orgId).count())).data().count
    const preset = input.preset !== undefined && input.counterpartyId === undefined ? await presetCounterpartyIn(t, db, orgId, input.preset) : null
    const draft = seriesFromInput(ref.id, preset === null ? input : { ...input, counterpartyId: preset.id }, '')
    const ctx = await readContext(t, db, orgId, draft, { category: true, counterparty: true, tags: draft.tags }, preset?.create === true)
    if (count >= (opts.maxCount ?? MAX_SERIES)) throw new RecurringError('limit_reached')

    const base: Series = { ...draft, currency: ctx.account.currency }
    const fill = fillPlan(base, today)
    const creates = fill.occurrences.map((o) => buildPlan(base, o, ctx, today))
    const series = withState(base, fill)
    const ts = Timestamp.fromDate(deps.now())
    if (preset?.create === true && input.preset !== undefined) writeSystemCounterparty(t, deps, orgId, uid, input.preset, ts)
    t.create(ref, storedSeries(series, orgId, uid, ts))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.create', uid, ref.id, null, seriesToDoc(series)))
    writePlans(t, deps, orgId, uid, { creates, updates: [], deletes: [] }, ctx.baseCurrency, ts)
    return { series, created: creates.length }
  })
}

export interface FillResult {
  /** False: the series is gone, paused, ended or already filled today (a parallel run did it). */
  due: boolean
  created: number
}

/**
 * The daily fill of one series (S11) in ONE transaction: due (`dueOn <= today`, checked inside, so two runs at once fill
 * once), the occurrences `fillPlan` gives (catch-up included), each created only when neither its operation nor its mark
 * exists, then the new fill state. Written as `system`. An unreadable series is refused (the cron reports it and waits a
 * day); a missing account is `account_not_found`.
 */
export async function fillSeries(deps: LedgerDeps, orgId: string, seriesId: string): Promise<FillResult> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const series = snap.exists ? parseSeries(snap.id, snap.data()) : null
    if (snap.exists && series === null) throw new RecurringError('invalid_input', 'series')
    const today = deps.today()
    if (series === null || series.dueOn === undefined || series.dueOn > today) return { due: false, created: 0 }
    const fill = fillPlan(series, today)
    const ctx = await readContext(t, db, orgId, series, NOT_STRICT)
    const ids = fill.occurrences.map((o) => planId(series.id, o))
    const ops = await readAll(t, ids.map((id) => transactionsCol(db, orgId).doc(id)))
    const marks = await readAll(t, ids.map((id) => recurringDoneCol(db, orgId).doc(id)))
    const creates = fill.occurrences.filter((_, i) => !ops[i].exists && !marks[i].exists).map((o) => buildPlan(series, o, ctx, today))
    const ts = Timestamp.fromDate(deps.now())
    writePlans(t, deps, orgId, RECURRING_UID, { creates, updates: [], deletes: [] }, ctx.baseCurrency, ts)
    t.update(ref, {
      generatedThrough: fill.generatedThrough ?? FieldValue.delete(),
      dueOn: fill.dueOn ?? FieldValue.delete(),
      currency: ctx.account.currency,
    })
    return { due: true, created: creates.length }
  })
}

export interface UpdatedSeries {
  series: Series
  created: number
  updated: number
  deleted: number
}

/**
 * A change of a series (S11) in ONE transaction. Paused: no new plans (`removeFuture` deletes the future unpaid ones, manual
 * ones too). Active (changed or resumed): the future unpaid plans that nobody changed by hand are rewritten to the new
 * schedule and content: the same occurrence is updated in place, an occurrence the new schedule no longer has is deleted
 * without a mark, a new one is created, and no occurrence is planned in a period that a mark or an operation the change
 * keeps (paid, manual, past) already takes (spec correction 8). At most REWRITE_CAP operations of the series are read.
 */
export async function updateSeries(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, patch: SeriesPatch): Promise<UpdatedSeries> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  const today = deps.today()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const prior = snap.exists ? parseSeries(snap.id, snap.data()) : null
    if (prior === null) throw new RecurringError('not_found')
    const changed = applySeriesPatch(prior, patch)
    assertSeriesHorizon(changed, today)
    const strict: Strict = {
      category: changed.categoryId !== prior.categoryId,
      counterparty: changed.counterpartyId !== prior.counterpartyId,
      tags: changed.tags.filter((id) => !prior.tags.includes(id)),
    }
    const ctx = await readContext(t, db, orgId, changed, strict)
    const next: Series = { ...changed, currency: ctx.account.currency }
    const periodFrom = periodStart(next, today)
    const opsSnap = await t.get(seriesOpsQuery(db, orgId, seriesId, addDays(periodFrom, -MAX_SHIFT_DAYS)).limit(REWRITE_CAP + 1))
    if (opsSnap.size > REWRITE_CAP) throw new RecurringError('limit_reached', 'planned')
    const ops = opsSnap.docs.flatMap((d) => {
      const tx = parseTransaction(d.id, d.data())
      return tx === null ? [] : [{ tx, old: d.data() }]
    })
    const future = ops.filter((o) => o.tx.status === 'planned' && o.tx.paymentDate >= today)
    const w: PlanWrites = { creates: [], updates: [], deletes: [] }
    let series: Series

    if (next.status === 'paused') {
      if (patch.removeFuture) w.deletes = future.map((o) => o.tx)
      series = withState(next, { generatedThrough: prior.generatedThrough })
    } else {
      const marksSnap = await t.get(seriesMarksQuery(db, orgId, seriesId, periodFrom).limit(MARKS_SCAN))
      const rewritable = future.filter((o) => o.tx.manual !== true)
      const rewritableIds = new Set(rewritable.map((o) => o.tx.id))
      const taken = new Set<string>()
      for (const d of marksSnap.docs) {
        const mark = parseDone(d.id, d.data())
        if (mark !== null) taken.add(periodOf(next, mark.occurrence))
      }
      for (const o of ops) {
        if (!rewritableIds.has(o.tx.id) && o.tx.occurrence !== undefined && o.tx.occurrence >= periodFrom) taken.add(periodOf(next, o.tx.occurrence))
      }
      const desired = rewriteOccurrences(next, today, taken)
      const desiredIds = desired.map((o) => planId(seriesId, o))
      // An operation with a wanted id outside the read above (moved by hand far back) must not be created twice.
      const others = await readAll(t, desiredIds.filter((id) => !rewritableIds.has(id)).map((id) => transactionsCol(db, orgId).doc(id)))
      const existing = new Set(others.filter((s) => s.exists).map((s) => s.id))
      for (const o of rewritable) {
        const i = desiredIds.indexOf(o.tx.id)
        if (i < 0) {
          w.deletes.push(o.tx)
          continue
        }
        const want = buildPlan(next, desired[i], ctx, today)
        if (!sameDoc(o.tx, want)) w.updates.push({ prior: o.tx, next: want, old: o.old })
      }
      desired.forEach((occurrence, i) => {
        const id = desiredIds[i]
        if (!rewritableIds.has(id) && !existing.has(id)) w.creates.push(buildPlan(next, occurrence, ctx, today))
      })
      series = withState(next, rewriteState(next, today))
    }

    const ts = Timestamp.fromDate(deps.now())
    t.set(ref, storedSeries(series, orgId, uid, ts, snap.data()))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.update', uid, seriesId, seriesToDoc(prior), seriesToDoc(series)))
    writePlans(t, deps, orgId, uid, w, ctx.baseCurrency, ts)
    return { series, created: w.creates.length, updated: w.updates.length, deleted: w.deletes.length }
  })
}

/**
 * Deletes a series (S11) in ONE transaction; with `delete` its future unpaid plans too (manual ones included). Paid and past
 * operations stay and keep `seriesId` as a trace; the marks stay. An unreadable series document can still be deleted.
 */
export async function deleteSeries(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, mode: FutureMode): Promise<{ deleted: number }> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  const today = deps.today()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const snap = await t.get(ref)
    const opsSnap = mode === 'delete' ? await t.get(seriesOpsQuery(db, orgId, seriesId, today).limit(REWRITE_CAP + 1)) : null
    if (!orgSnap.exists || !snap.exists) throw new RecurringError('not_found')
    if (opsSnap !== null && opsSnap.size > REWRITE_CAP) throw new RecurringError('limit_reached', 'planned')
    const deletes = (opsSnap?.docs ?? []).flatMap((d) => {
      const tx = parseTransaction(d.id, d.data())
      return tx !== null && tx.status === 'planned' ? [tx] : []
    })
    const prior = parseSeries(snap.id, snap.data())
    const ts = Timestamp.fromDate(deps.now())
    t.delete(ref)
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.delete', uid, seriesId, prior === null ? (snap.data() ?? null) : seriesToDoc(prior), null))
    writePlans(t, deps, orgId, uid, { creates: [], updates: [], deletes }, orgSnap.get('currency') as string, ts)
    return { deleted: deletes.length }
  })
}
