import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import type { Tag } from './types'

/** Every list shows the tags in this order: by the comparable name (case and Latin diacritics ignored), then by id. A new array. */
export function sortTags<T extends Pick<Tag, 'id' | 'name'>>(tags: readonly T[]): T[] {
  return [...tags].sort((a, b) => {
    const x = nameKeyText(a.name)
    const y = nameKeyText(b.name)
    if (x !== y) return x < y ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * The tags a picker offers for what was typed: not chosen yet, not archived (unless `includeArchived`, for taking a tag
 * off), whose name contains the typed text the way the uniqueness key compares names. In the order of `sortTags`.
 */
export function pickableTags(tags: readonly Tag[], query: string, chosen: readonly string[], opts: { includeArchived?: boolean } = {}): Tag[] {
  const q = nameKeyText(query)
  return sortTags(
    tags.filter((t) => !chosen.includes(t.id) && (opts.includeArchived === true || !t.archived) && (q === '' || nameKeyText(t.name).includes(q))),
  )
}

/** The tag that already owns this name (the same key as on the server, archived tags included), if any. */
export function tagByName(tags: readonly Tag[], name: string): Tag | undefined {
  const key = nameKeyText(name)
  return key === '' ? undefined : tags.find((t) => nameKeyText(t.name) === key)
}
