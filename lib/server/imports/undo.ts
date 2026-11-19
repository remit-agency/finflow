import 'server-only'
import { FieldPath, FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import type { UndoResult } from '@/lib/domain/import/view'
import { BANK_CLIENT_ID_PREFIX } from '@/lib/domain/ledger/input'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankSeenCol } from '@/lib/server/banking/paths'
import { transactionsCol } from '@/lib/server/ledger/paths'
import { deleteTransaction } from '@/lib/server/ledger/write'
import type { ImportDeps } from './deps'
import { ImportError } from './errors'
import { importsCol } from './paths'
import { parseImportDoc, type ImportDoc } from './types'

/** Operations deleted per undo step (S14): one step is one request, so it stays well inside the time limit. */
export const UNDO_STEP = 25

export type { UndoResult }

/**
 * Removes one page (UNDO_STEP) of an import's operations (S14). An operation is deleted only while it is untouched since
 * the import (its `updateTime` equals its `createTime`); anything else is kept and reported. Each deleted operation loses its
 * `bankSeen` mark first, so a crash in between leaves an operation without a mark, which the next undo finds again. A ledger
 * refusal puts the mark back and keeps the operation. The last step marks the import `undone`. Safe to repeat.
 */
export async function undoStep(deps: ImportDeps, orgId: string, uid: string, importId: string, cursor?: string): Promise<UndoResult> {
  const ref = importsCol(deps.db, orgId).doc(importId)
  const doc = await readImport(ref)
  if (doc.status === 'undone') return { deleted: 0, kept: [], next: null, done: true }
  if (doc.status === 'applied') await ref.update({ status: 'undoing' })

  let q = transactionsCol(deps.db, orgId).where('bank.importId', '==', importId).orderBy(FieldPath.documentId()).limit(UNDO_STEP)
  if (cursor !== undefined) q = q.startAfter(cursor)
  const snap = await q.get()
  let deleted = 0
  const kept: UndoResult['kept'] = []
  for (const d of snap.docs) {
    // Untouched since the import: the document was never written after it was created (Firestore times).
    if (!d.updateTime.isEqual(d.createTime)) {
      kept.push({ id: d.id, reason: 'changed' })
      continue
    }
    const key = d.id.startsWith(BANK_CLIENT_ID_PREFIX) ? d.id.slice(BANK_CLIENT_ID_PREFIX.length) : null
    const markRef = key === null ? null : bankSeenCol(deps.db, orgId).doc(key)
    const markSnap = markRef === null ? null : await markRef.get()
    try {
      // The mark goes first: a crash between the two leaves an operation without a mark, which this step finds again
      // (the reverse order would leave a mark without an operation, and the file could never be imported again).
      if (markSnap?.exists) await markRef!.delete()
      await deleteTransaction(deps.ledger, orgId, uid, d.id, 'import-undo')
      deleted++
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e
      // The operation stays; its mark is written back (same data) so a re-import does not duplicate it.
      if (markSnap?.exists) await markRef!.set(markSnap.data()!)
      kept.push({ id: d.id, reason: e.code })
    }
  }
  const last = snap.docs.length < UNDO_STEP
  const next = last ? null : snap.docs[snap.docs.length - 1].id
  const progress = { 'undo.deleted': FieldValue.increment(deleted), 'undo.kept': FieldValue.increment(kept.length) }
  if (last) await ref.update({ ...progress, status: 'undone', undoneAt: Timestamp.fromDate(deps.now()) })
  else await ref.update(progress)
  return { deleted, kept, next, done: last }
}

/** The import the undo acts on: ImportError('not_found') when it is missing or does not parse. */
async function readImport(ref: DocumentReference): Promise<ImportDoc> {
  const doc = parseImportDoc((await ref.get()).data())
  if (doc === null) throw new ImportError('not_found')
  return doc
}
