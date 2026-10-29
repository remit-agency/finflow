import 'server-only'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { parseTag, tagToDoc } from '@/lib/domain/tags/doc'
import { TagError } from '@/lib/domain/tags/errors'
import type { TagInput, TagPatch } from '@/lib/domain/tags/input'
import { tagNameKey } from '@/lib/domain/tags/keys'
import { MAX_TAGS, type Tag, type UpdateTagResult } from '@/lib/domain/tags/types'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, orgRef, tagKeysCol, tagsCol, transactionsCol } from '@/lib/server/ledger/paths'

/** What a tag write needs: Admin Firestore and the clock (the ledger deps have both). */
export interface TagDeps {
  db: Firestore
  now: () => Date
  /** Overrides the per-company limit (tests). */
  maxCount?: number
}

function duplicate(existing: { get: (field: string) => unknown }): TagError {
  return new TagError('duplicate', { field: 'name', existingId: existing.get('tagId') as string })
}

/** A new tag. The limit, the name key, the tag and the audit entry are one transaction. */
export async function createTag(deps: TagDeps, orgId: string, uid: string, input: TagInput): Promise<Tag> {
  const ref = tagsCol(deps.db, orgId).doc()
  const keyRef = tagKeysCol(deps.db, orgId).doc(tagNameKey(input.name))
  const limit = deps.maxCount ?? MAX_TAGS
  return deps.db.runTransaction(async (t) => {
    // All reads first.
    const org = await t.get(orgRef(deps.db, orgId))
    const count = (await t.get(tagsCol(deps.db, orgId).count())).data().count
    const taken = await t.get(keyRef)

    if (!org.exists) throw new TagError('not_found')
    if (taken.exists) throw duplicate(taken)
    if (count >= limit) throw new TagError('limit_reached')

    const tag: Tag = { id: ref.id, name: input.name, color: input.color, excludeFromAnalytics: input.excludeFromAnalytics, archived: false, recalcPending: false }
    const ts = Timestamp.fromDate(deps.now())
    t.create(ref, { ...tagToDoc(tag), orgId, createdAt: ts, createdBy: uid, updatedAt: ts })
    t.create(keyRef, { tagId: ref.id })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'tag.create', uid, ref.id, null, tagToDoc(tag)))
    return tag
  })
}

/**
 * Changes what the patch gives. A rename moves the name key. A change of `excludeFromAnalytics` of a tag that some
 * operation carries sets `recalcPending` in the same transaction and answers `recalc: true`: the browser then runs the
 * recalculation steps. Archiving never touches the flag and needs no recalculation.
 */
export async function updateTag(deps: TagDeps, orgId: string, uid: string, id: string, patch: TagPatch): Promise<UpdateTagResult> {
  const ref = tagsCol(deps.db, orgId).doc(id)
  const keysCol = tagKeysCol(deps.db, orgId)
  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const prior = snap.exists ? parseTag(snap.id, snap.data()) : null
    if (!prior) throw new TagError('not_found')

    const after: Tag = {
      ...prior,
      name: patch.name ?? prior.name,
      color: patch.color ?? prior.color,
      excludeFromAnalytics: patch.excludeFromAnalytics ?? prior.excludeFromAnalytics,
      archived: patch.archived ?? prior.archived,
    }
    const oldKey = tagNameKey(prior.name)
    const newKey = tagNameKey(after.name)
    const rekey = oldKey !== newKey
    const flagChanged = after.excludeFromAnalytics !== prior.excludeFromAnalytics
    // All reads first.
    const taken = rekey ? await t.get(keysCol.doc(newKey)) : null
    const leaving = rekey ? await t.get(keysCol.doc(oldKey)) : null
    const used = flagChanged ? await t.get(transactionsCol(deps.db, orgId).where('tags', 'array-contains', id).select().limit(1)) : null

    if (taken !== null && taken.exists && taken.get('tagId') !== id) throw duplicate(taken)
    const recalc = used !== null && !used.empty
    const stored: Tag = { ...after, recalcPending: recalc ? true : prior.recalcPending }

    // `update` keeps orgId, createdAt and createdBy.
    t.update(ref, { ...tagToDoc(stored), updatedAt: Timestamp.fromDate(deps.now()) })
    if (taken !== null) {
      if (leaving !== null && leaving.exists && leaving.get('tagId') === id) t.delete(keysCol.doc(oldKey))
      if (!taken.exists) t.create(keysCol.doc(newKey), { tagId: id })
    }
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'tag.update', uid, id, tagToDoc(prior), tagToDoc(stored)))
    return { tag: stored, recalc }
  })
}
