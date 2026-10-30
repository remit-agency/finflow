// Pure part of scripts/check-tags.ts (S10t rollout guard). Unit-tested in Vitest.

/** One operation as the check reads it: its id and whatever is stored in `tags`. */
export interface TaggedDoc {
  id: string
  tags: unknown
}

/**
 * The operations whose `tags` hold anything but the ids of the company's tags: free text from before S10t, an entry that
 * is not a string, or a `tags` that is not a list. An absent or empty `tags` is fine. Such an operation could not be edited
 * once the ledger checks tag ids (`invalid_input` on `tags`).
 */
export function freeTextTagged(docs: readonly TaggedDoc[], tagIds: ReadonlySet<string>): string[] {
  return docs
    .filter(({ tags }) => {
      if (tags === undefined) return false
      if (!Array.isArray(tags)) return true
      return tags.some((t) => typeof t !== 'string' || !tagIds.has(t))
    })
    .map((d) => d.id)
}
