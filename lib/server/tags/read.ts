import 'server-only'
import type { Firestore } from 'firebase-admin/firestore'
import { parseTag } from '@/lib/domain/tags/doc'
import { TagError } from '@/lib/domain/tags/errors'
import { sortTags } from '@/lib/domain/tags/search'
import type { Tag } from '@/lib/domain/tags/types'
import { tagsCol, transactionsCol } from '@/lib/server/ledger/paths'

/** `GET /tags`: every readable tag of the company (at most 100), the archived ones too, by name. */
export async function listTags(db: Firestore, orgId: string): Promise<Tag[]> {
  const snap = await tagsCol(db, orgId).get()
  return sortTags(snap.docs.map((d) => parseTag(d.id, d.data())).filter((t): t is Tag => t !== null))
}

/** `GET /tags/{id}/impact`: how many operations carry the tag, by an aggregate `count()` (no document is read). */
export async function tagImpact(db: Firestore, orgId: string, tagId: string): Promise<number> {
  const snap = await tagsCol(db, orgId).doc(tagId).get()
  if (!snap.exists || parseTag(snap.id, snap.data()) === null) throw new TagError('not_found')
  return (await transactionsCol(db, orgId).where('tags', 'array-contains', tagId).count().get()).data().count
}
