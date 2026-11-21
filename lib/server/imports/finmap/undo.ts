import 'server-only'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { footprintOf, splitByWriteBudget } from '@/lib/domain/import/finmap/budget'
import { WRITE_BUDGET } from '@/lib/domain/import/finmap/types'
import type { UndoResult } from '@/lib/domain/import/view'
import { changeSet, combineChanges, type ChangeSet } from '@/lib/domain/ledger/change'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { FINMAP_CLIENT_ID_PREFIX } from '@/lib/domain/ledger/input'
import { bankSeenCol } from '@/lib/server/banking/paths'
import { auditData } from '@/lib/server/ledger/audit'
import { assertUnlocked } from '@/lib/server/ledger/lock'
import { accountsCol, auditCol, orgRef, transactionsCol } from '@/lib/server/ledger/paths'
import { applyChange } from '@/lib/server/ledger/write'
import type { ImportDeps } from '../deps'
import { ImportError } from '../errors'
import { importsCol } from '../paths'
import { withAccountLocks } from '../step'
import { parseImportDoc, type ImportDoc } from '../types'

/** Operations per undo step: the batch size of the import (one request of the batch writer). */
export const FINMAP_UNDO_PAGE = 60
/** Marks read per batch when the undo removes the marks left without an operation. */
const MARK_BATCH = 200

export interface FinmapUndoOptions {
  /** The writes one undo transaction may hold. Default: the Firestore budget; tests inject a smaller one. */
  budget?: number
}

/** An operation of the page that may go: what the page read, and the change that takes it back. */
interface Candidate {
  id: string
  /** The version the page read (equal to its creation time: nothing changed it since the import). */
  updateTime: Timestamp
  change: ChangeSet
  docs: string[]
}

/**
 * Removes one page (60) of a Finmap import's operations (S14b step 6). The page is the operations whose `importId` is the
 * import, ordered by document id after the cursor. An operation is deleted only while it is untouched since the import
 * (`updateTime == createTime`) and still at the version the page read; anything else is kept with reason `changed`. The
 * operations of a page are split by the write budget (`splitByWriteBudget`, the footprint of their reverse change sets): each
 * group is one transaction that holds the step's locks (taken by the caller), re-reads its operations and marks, applies one
 * combined reverse change, deletes the operations with their marks, and writes one audit entry (`import.batch`,
 * `via: 'import-undo'`). The last page also removes the marks left without an operation (a person deleted it) and marks the
 * import `undone`. Repeatable: a finished step deletes nothing, and an undone import answers `done` at once.
 */
export async function undoFinmapStep(deps: ImportDeps, orgId: string, uid: string, importId: string, cursor?: string, options: FinmapUndoOptions = {}): Promise<UndoResult> {
  const ref = importsCol(deps.db, orgId).doc(importId)
  const doc = parseImportDoc((await ref.get()).data())
  if (doc === null || doc.kind !== 'finmap') throw new ImportError('not_found')
  if (doc.status === 'undone') return { deleted: 0, kept: [], next: null, done: true }
  const budget = options.budget ?? WRITE_BUDGET
  return withAccountLocks(deps, orgId, doc.accountIds, () => undoPage(deps, orgId, uid, importId, doc.status, cursor, budget))
}

async function undoPage(deps: ImportDeps, orgId: string, uid: string, importId: string, status: ImportDoc['status'], cursor: string | undefined, budget: number): Promise<UndoResult> {
  const { db } = deps
  const ref = importsCol(db, orgId).doc(importId)
  if (status === 'applied') await ref.update({ status: 'undoing' })
  const base = await baseCurrencyOf(deps, orgId)

  let q = transactionsCol(db, orgId).where('importId', '==', importId).orderBy(FieldPath.documentId()).limit(FINMAP_UNDO_PAGE)
  if (cursor !== undefined) q = q.startAfter(cursor)
  const snap = await q.get()

  const kept: UndoResult['kept'] = []
  const candidates: Candidate[] = []
  for (const d of snap.docs) {
    if (!d.updateTime.isEqual(d.createTime)) {
      kept.push({ id: d.id, reason: 'changed' })
      continue
    }
    const tx = d.id.startsWith(FINMAP_CLIENT_ID_PREFIX) ? parseTransaction(d.id, d.data()) : null
    if (tx === null) {
      kept.push({ id: d.id, reason: 'unreadable' })
      continue
    }
    const change = changeSet(tx, null, base)
    candidates.push({ id: d.id, updateTime: d.updateTime, change, docs: footprintOf(change) })
  }

  let deleted = 0
  try {
    for (const group of splitByWriteBudget(candidates.map((c) => ({ docs: c.docs })), budget)) {
      const r = await deleteGroup(deps, orgId, uid, base, importId, group.map((i) => candidates[i]))
      deleted += r.deleted
      kept.push(...r.kept)
    }
  } finally {
    // What was deleted is a fact of the import, also when a transaction threw.
    await ref.update({ 'undo.deleted': FieldValue.increment(deleted), 'undo.kept': FieldValue.increment(kept.length) })
  }

  const last = snap.docs.length < FINMAP_UNDO_PAGE
  if (last) {
    await removeOrphanMarks(deps, orgId, importId)
    await ref.update({ status: 'undone', undoneAt: Timestamp.fromDate(deps.now()) })
  }
  return { deleted, kept, next: last ? null : snap.docs[snap.docs.length - 1].id, done: last }
}

/**
 * One transaction for a group: the ledger lock, the company's currency, every operation and mark of the group (an operation
 * whose version moved is kept `changed`; one that is gone is skipped), the accounts the reverse change moves (each must
 * exist), then the writes: one combined change, the operations and their marks deleted, one audit entry.
 */
async function deleteGroup(deps: ImportDeps, orgId: string, uid: string, base: string, importId: string, group: Candidate[]): Promise<{ deleted: number; kept: UndoResult['kept'] }> {
  const { db } = deps
  const opRefs = group.map((c) => transactionsCol(db, orgId).doc(c.id))
  const markRefs = group.map((c) => bankSeenCol(db, orgId).doc(c.id.slice(FINMAP_CLIENT_ID_PREFIX.length)))
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps.ledger, orgId)
    const org = await t.get(orgRef(db, orgId))
    if (!org.exists || org.get('currency') !== base) throw new LedgerError('conflict')
    const opSnaps = await t.getAll(...opRefs)
    const markSnaps = await t.getAll(...markRefs)

    const kept: UndoResult['kept'] = []
    const live: number[] = []
    group.forEach((c, i) => {
      const s = opSnaps[i]
      if (!s.exists) return
      if (!s.updateTime?.isEqual(c.updateTime)) kept.push({ id: c.id, reason: 'changed' })
      else live.push(i)
    })
    if (live.length === 0) return { deleted: 0, kept }

    const change = combineChanges(...live.map((i) => group[i].change))
    const accountIds = Object.keys(change.balanceDeltas)
    if (accountIds.length > 0) {
      const accounts = await t.getAll(...accountIds.map((id) => accountsCol(db, orgId).doc(id)))
      if (accounts.some((a) => !a.exists)) throw new LedgerError('conflict')
    }

    applyChange(t, db, orgId, change, Timestamp.fromDate(deps.now()))
    for (const i of live) {
      t.delete(opRefs[i])
      if (markSnaps[i].exists) t.delete(markRefs[i])
    }
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'import.batch', uid, importId, null, { importId, deleted: live.length }, { via: 'import-undo' }))
    return { deleted: live.length, kept }
  })
}

/**
 * The marks of the import whose operation is gone: a person deleted the operation, so no undo step found its mark. Left there,
 * the mark would make a re-import skip the line and the operation would never come back.
 */
async function removeOrphanMarks(deps: ImportDeps, orgId: string, importId: string): Promise<void> {
  const { db } = deps
  const marks = bankSeenCol(db, orgId)
  const operations = transactionsCol(db, orgId)
  let after: string | undefined
  for (;;) {
    let q = marks.where('importId', '==', importId).orderBy(FieldPath.documentId()).limit(MARK_BATCH)
    if (after !== undefined) q = q.startAfter(after)
    const snap = await q.get()
    if (snap.empty) return
    const opSnaps = await db.getAll(...snap.docs.map((m) => operations.doc(`${FINMAP_CLIENT_ID_PREFIX}${m.id}`)))
    const batch = db.batch()
    let orphans = 0
    snap.docs.forEach((m, i) => {
      if (opSnaps[i].exists) return
      batch.delete(m.ref)
      orphans++
    })
    if (orphans > 0) await batch.commit()
    if (snap.docs.length < MARK_BATCH) return
    after = snap.docs[snap.docs.length - 1].id
  }
}

async function baseCurrencyOf(deps: ImportDeps, orgId: string): Promise<string> {
  const org = await orgRef(deps.db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  return org.get('currency') as string
}
