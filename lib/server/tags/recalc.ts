import 'server-only'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { parseTag } from '@/lib/domain/tags/doc'
import { TagError } from '@/lib/domain/tags/errors'
import { RECALC_PER_STEP, type RecalcStepResult } from '@/lib/domain/tags/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { tagsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { refreshExcluded } from '@/lib/server/ledger/write'

/**
 * One step of the recalculation after a tag's flag changed (S10t): the next `limit` operations that carry the tag, in
 * the order of their ids (`array-contains` over the automatic single-field index), each brought in line with its tags
 * in its own Firestore transaction (`refreshExcluded`). Safe to repeat: an operation that already agrees is left alone.
 * The step that reads the last operations clears `recalcPending`. A ledger refusal (`ledger_busy` during a rebuild)
 * ends the step with that error; the next call starts again from the same cursor.
 */
export async function recalcStep(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  tagId: string,
  cursor: string | null,
  limit: number = RECALC_PER_STEP,
): Promise<RecalcStepResult> {
  const tagRef = tagsCol(deps.db, orgId).doc(tagId)
  const tagSnap = await tagRef.get()
  if (!tagSnap.exists || parseTag(tagSnap.id, tagSnap.data()) === null) throw new TagError('not_found')

  let q = transactionsCol(deps.db, orgId).where('tags', 'array-contains', tagId).orderBy(FieldPath.documentId()).select()
  if (cursor !== null) q = q.startAfter(cursor)
  const snap = await q.limit(limit).get()
  let changed = 0
  for (const d of snap.docs) if (await refreshExcluded(deps, orgId, uid, d.id)) changed++

  const done = snap.size < limit
  if (done) {
    await deps.db.runTransaction(async (t) => {
      const current = await t.get(tagRef)
      if (current.exists && current.get('recalcPending') === true) t.update(tagRef, { recalcPending: false, updatedAt: Timestamp.fromDate(deps.now()) })
    })
  }
  return { scanned: snap.size, changed, done, cursor: done || snap.size === 0 ? null : snap.docs[snap.size - 1].id }
}
