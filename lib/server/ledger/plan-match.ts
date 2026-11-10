import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { doneToDoc, parseDone } from '@/lib/domain/recurring/doc'
import { canMatch, carriedOf, parseBankSide, parsePlanSide, withCarried, withoutCarried } from '@/lib/domain/recurring/match'
import { planId } from '@/lib/domain/recurring/plan'
import type { Carried } from '@/lib/domain/recurring/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { auditCol, categoriesCol, counterpartiesCol, orgRef, recurringDoneCol, tagsCol, transactionsCol } from './paths'
import { operationOf } from './transfer'
import { applyChange, storedDoc } from './write'

/** One «план → факт»: the plan, the bank operation and, from a suggestion, the versions the person saw (in that order). */
export interface MatchJob {
  planId: string
  bankId: string
  versions?: readonly [Timestamp, Timestamp]
}

export interface MatchDone {
  /** The bank operation after the write. */
  bank: LedgerTransaction
  /** The plan: the one that went (a confirmation) or came back (an undo). */
  plan: LedgerTransaction
}

async function tagSnapsOf(t: Transaction, db: Firestore, orgId: string, ids: readonly string[]): Promise<DocumentSnapshot[]> {
  const snaps: DocumentSnapshot[] = []
  for (const id of ids) snaps.push(await t.get(tagsCol(db, orgId).doc(id)))
  return snaps
}

/**
 * Confirms that a bank operation paid a plan (S11) in ONE transaction: the bank operation stays (its id, amount, day, bank
 * block and `bankSeen` mark untouched), takes from the plan each of category, counterparty, comment and tags it lacks
 * (a carried reference that is gone or archived is not carried), keeps its rules trace and gets the series link; the plan
 * is deleted; the occurrence gets a `paid` mark that keeps the plan's document and what was carried (for the undo).
 * No balance moves (the same account, amount and day); the category moves the bank operation's rollups. Audit: `tx.update`
 * of the bank operation and `tx.delete` of the plan, both `via: 'plan'`.
 */
export async function confirmMatch(deps: LedgerDeps, orgId: string, uid: string, job: MatchJob): Promise<MatchDone> {
  const { db } = deps
  const planRef = transactionsCol(db, orgId).doc(job.planId)
  const bankRef = transactionsCol(db, orgId).doc(job.bankId)
  const markRef = recurringDoneCol(db, orgId).doc(job.planId)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const planSnap = await t.get(planRef)
    const bankSnap = await t.get(bankRef)
    const markSnap = await t.get(markRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const versions = job.versions
    if (versions) {
      const seen = [planSnap, bankSnap]
      seen.forEach((snap, i) => {
        if (snap.exists && (!snap.updateTime || !snap.updateTime.isEqual(versions[i]))) throw new LedgerError('conflict')
      })
    }
    const plan = operationOf(planSnap)
    const bank = operationOf(bankSnap)
    const planSide = parsePlanSide(planSnap.id, planSnap.data(), '')
    const bankSide = parseBankSide(bankSnap.id, bankSnap.data(), '')
    if (planSide === null || bankSide === null || markSnap.exists || !canMatch(planSide, bankSide)) throw new LedgerError('not_eligible')

    const wanted = carriedOf(plan, bank)
    const categorySnap = wanted.categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(wanted.categoryId))
    const counterpartySnap = wanted.counterpartyId === undefined ? null : await t.get(counterpartiesCol(db, orgId).doc(wanted.counterpartyId))
    const tagSnaps = await tagSnapsOf(t, db, orgId, wanted.tags ?? bank.tags)
    const carried: Carried = {}
    if (categorySnap?.exists && categorySnap.get('type') === bank.type) carried.categoryId = wanted.categoryId
    if (counterpartySnap?.exists && counterpartySnap.get('archived') !== true) carried.counterpartyId = wanted.counterpartyId
    if (wanted.description !== undefined) carried.description = wanted.description
    if (wanted.tags !== undefined) {
      const usable = wanted.tags.filter((_, i) => tagSnaps[i].exists && tagSnaps[i].get('archived') !== true)
      if (usable.length > 0) carried.tags = usable
    }
    const linked: LedgerTransaction = { ...withCarried(bank, carried), seriesId: plan.seriesId, occurrence: plan.occurrence }
    const next = withExcluded(linked, excludedFromTags(linked.tags, tagFlagsOf(tagSnaps)))

    const baseCurrency = orgSnap.get('currency') as string
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(bank, next, baseCurrency), changeSet(plan, null, baseCurrency)), ts)
    t.set(bankRef, storedDoc(next, orgId, uid, ts, bankSnap.data() ?? {}))
    t.delete(planRef)
    t.create(markRef, {
      ...doneToDoc({
        seriesId: plan.seriesId as string,
        occurrence: plan.occurrence as string,
        reason: 'paid',
        txId: bank.id,
        estimated: plan.estimated === true,
        manual: plan.manual === true,
        plan: transactionToDoc(plan),
        carried,
      }),
      planCreatedAt: planSnap.get('createdAt') ?? null,
      planCreatedBy: planSnap.get('createdBy') ?? null,
      at: ts,
      by: uid,
    })
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, bank.id, transactionToDoc(bank), transactionToDoc(next), { via: 'plan' }))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, plan.id, transactionToDoc(plan), null, { via: 'plan' }))
    return { bank: next, plan }
  })
}

/**
 * Undoes a confirmed match (S11) in ONE transaction: the plan comes back from its mark exactly (its document, creation stamp
 * and order in the journal), the bank operation loses the series link and each carried field it still has unchanged (a
 * person's later change stays), the mark goes. `not_found` without a mark; `not_eligible` for a mark that is no match
 * (`paid` by the plan itself, `skipped`, `deleted`: those come back through the create route); `conflict` when the plan
 * already exists. Audit: `tx.update` of the bank operation and `tx.create` of the plan, both `via: 'plan'`.
 */
export async function undoMatch(deps: LedgerDeps, orgId: string, uid: string, id: string): Promise<MatchDone> {
  const { db } = deps
  const planRef = transactionsCol(db, orgId).doc(id)
  const markRef = recurringDoneCol(db, orgId).doc(id)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const markSnap = await t.get(markRef)
    const planSnap = await t.get(planRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const mark = markSnap.exists ? parseDone(markSnap.id, markSnap.data()) : null
    if (mark === null) throw new LedgerError('not_found')
    if (mark.reason !== 'paid' || mark.txId === undefined || mark.txId === id || mark.plan === undefined) throw new LedgerError('not_eligible')
    const bankRef = transactionsCol(db, orgId).doc(mark.txId)
    const bankSnap = await t.get(bankRef)
    const bank = operationOf(bankSnap)
    const plan = parseTransaction(id, mark.plan)
    if (planSnap.exists) throw new LedgerError('conflict')
    if (plan === null || bank.seriesId !== mark.seriesId || bank.occurrence !== mark.occurrence) throw new LedgerError('not_eligible')

    const unlinked = withoutCarried(bank, mark.carried ?? {})
    const tagIds = [...new Set([...unlinked.tags, ...plan.tags])]
    const flags = tagFlagsOf(await tagSnapsOf(t, db, orgId, tagIds))
    const nextBank = withExcluded(unlinked, excludedFromTags(unlinked.tags, flags))
    const restored = withExcluded(plan, excludedFromTags(plan.tags, flags))

    const baseCurrency = orgSnap.get('currency') as string
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(bank, nextBank, baseCurrency), changeSet(null, restored, baseCurrency)), ts)
    t.set(bankRef, storedDoc(nextBank, orgId, uid, ts, bankSnap.data() ?? {}))
    t.create(planRef, storedDoc(restored, orgId, uid, ts, { createdAt: markSnap.get('planCreatedAt') ?? undefined, createdBy: markSnap.get('planCreatedBy') ?? undefined }))
    t.delete(markRef)
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, bank.id, transactionToDoc(bank), transactionToDoc(nextBank), { via: 'plan' }))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.create', uid, id, null, transactionToDoc(restored), { via: 'plan' }))
    return { bank: nextBank, plan: restored }
  })
}

/**
 * «Пропустити цей раз» (S11) in ONE transaction: the plan of the occurrence is deleted and the occurrence gets a `skipped`
 * mark with the plan's flags, so neither the daily fill nor a change of the series brings it back; the undo is the create
 * route under the plan id (`planRestoreOf` in write.ts). Returns the plan as it was. `not_found` when the occurrence has no
 * plan of this series, `conflict` when it is marked already. Audit: `tx.delete`, `via: 'plan'`.
 */
export async function skipOccurrence(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, occurrence: string): Promise<LedgerTransaction> {
  const { db } = deps
  const id = planId(seriesId, occurrence)
  const opRef = transactionsCol(db, orgId).doc(id)
  const markRef = recurringDoneCol(db, orgId).doc(id)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const opSnap = await t.get(opRef)
    const markSnap = await t.get(markRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const op = operationOf(opSnap)
    if (op.status !== 'planned' || op.seriesId !== seriesId || op.occurrence !== occurrence) throw new LedgerError('not_eligible')
    if (markSnap.exists) throw new LedgerError('conflict')
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, changeSet(op, null, orgSnap.get('currency') as string), ts)
    t.delete(opRef)
    t.set(markRef, { ...doneToDoc({ seriesId, occurrence, reason: 'skipped', estimated: op.estimated === true, manual: op.manual === true }), at: ts, by: uid })
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, id, transactionToDoc(op), null, { via: 'plan' }))
    return op
  })
}
