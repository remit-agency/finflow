import { isId } from '@/lib/domain/ledger/guards'
import { MAX_TX_TAGS } from './types'

/** What a bulk change does to the tags of each operation (S10t). */
export interface TagChange {
  add: readonly string[]
  remove: readonly string[]
}

/** The tag ids of a request: an array of at most `max` safe document ids, none twice; null when it is not one. */
export function tagIdsOf(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null
  if (!v.every((id) => isId(id)) || new Set(v).size !== v.length) return null
  return [...(v as string[])]
}

/**
 * The tags after a change: the current ones without `remove`, then the ones of `add` that are not there yet, in their
 * order, while there is room. Never more than `max` (what is already there is never dropped), never a repeat.
 */
export function mergeTags(current: readonly string[], add: readonly string[], remove: readonly string[] = [], max: number = MAX_TX_TAGS): string[] {
  const out = current.filter((id) => !remove.includes(id))
  for (const id of add) {
    if (out.length >= max) break
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** The same ids in the same order. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}
