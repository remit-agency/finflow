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

/** How a name matches the typed text (its name key): 0 is the whole name, 1 its start, 2 somewhere inside it. */
function matchRank(name: string, q: string): number {
  const key = nameKeyText(name)
  return key === q ? 0 : key.startsWith(q) ? 1 : 2
}

/**
 * The tags a picker offers for what was typed: not chosen yet, not archived (unless `includeArchived`, for taking a tag
 * off), whose name contains the typed text the way the uniqueness key compares names. The whole name the text is comes
 * first, then the names it starts, then the rest; inside each group the order of `sortTags`. Nothing typed: `sortTags`.
 */
export function pickableTags(tags: readonly Tag[], query: string, chosen: readonly string[], opts: { includeArchived?: boolean } = {}): Tag[] {
  const q = nameKeyText(query)
  const offered = sortTags(
    tags.filter((t) => !chosen.includes(t.id) && (opts.includeArchived === true || !t.archived) && (q === '' || nameKeyText(t.name).includes(q))),
  )
  if (q === '') return offered
  // Array.prototype.sort is stable, so each group keeps the order of `sortTags`.
  return offered.map((tag) => ({ tag, rank: matchRank(tag.name, q) })).sort((a, b) => a.rank - b.rank).map((x) => x.tag)
}

/** The tag that already owns this name (the same key as on the server, archived tags included), if any. */
export function tagByName(tags: readonly Tag[], name: string): Tag | undefined {
  const key = nameKeyText(name)
  return key === '' ? undefined : tags.find((t) => nameKeyText(t.name) === key)
}
