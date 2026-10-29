import type { LedgerTransaction } from '@/lib/domain/ledger/types'

/** What the `excluded` flag of an operation needs to know about one tag (S10t). */
export interface TagFlags {
  excludeFromAnalytics: boolean
}

/** A tag document as a reader sees it (a Firestore snapshot fits): its id, whether it exists, its fields. */
export interface TagFlagSource {
  id: string
  exists: boolean
  get(field: string): unknown
}

/** The rule of S10t: an operation is excluded when at least one of its tags has the flag. A tag that does not exist does not exclude. */
export function excludedFromTags(tagIds: readonly string[], tags: ReadonlyMap<string, TagFlags>): boolean {
  return tagIds.some((id) => tags.get(id)?.excludeFromAnalytics === true)
}

/** The flags of the tag documents that exist, by id; anything but `true` is no flag. */
export function tagFlagsOf(docs: readonly TagFlagSource[]): Map<string, TagFlags> {
  const out = new Map<string, TagFlags>()
  for (const d of docs) if (d.exists) out.set(d.id, { excludeFromAnalytics: d.get('excludeFromAnalytics') === true })
  return out
}

/** The operation with `excluded` set (true) or without the key (false): the ledger stores the flag only when it is on. */
export function withExcluded(tx: LedgerTransaction, excluded: boolean): LedgerTransaction {
  const { excluded: _old, ...rest } = tx
  void _old
  return excluded ? { ...rest, excluded: true } : rest
}
