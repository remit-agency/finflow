import 'server-only'
import type { TagInput, TagPatch } from '@/lib/domain/tags/input'
import { ledgerDeps } from '@/lib/server/ledger'
import { listTags, tagImpact } from './read'
import { recalcStep } from './recalc'
import { createTag, updateTag } from './write'

/** The tags service bound to the production Firestore and clock. */
export const tags = {
  list: (orgId: string) => listTags(ledgerDeps().db, orgId),
  create: (orgId: string, uid: string, input: TagInput) => createTag(ledgerDeps(), orgId, uid, input),
  update: (orgId: string, uid: string, tagId: string, patch: TagPatch) => updateTag(ledgerDeps(), orgId, uid, tagId, patch),
  impact: (orgId: string, tagId: string) => tagImpact(ledgerDeps().db, orgId, tagId),
  recalculate: (orgId: string, uid: string, tagId: string, cursor: string | null) => recalcStep(ledgerDeps(), orgId, uid, tagId, cursor),
}
