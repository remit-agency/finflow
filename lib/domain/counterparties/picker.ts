import type { Counterparty } from './types'

/** A row of the counterparty picker's list: «none», a counterparty, or «add». */
export type PickerRow = { kind: 'none' } | { kind: 'item'; counterparty: Counterparty } | { kind: 'create' }

/**
 * The highlighted row of the open list. `moved` is the row the person moved the highlight to (arrows or a real pointer
 * move), or null while they have not: then the highlight follows the list as it is now. With a query it is the first
 * match (or «add»); without one it is the chosen counterparty as soon as it is in the list (it may still be loading),
 * else «none». A moved highlight is clamped, because a narrower query can shorten the list under it.
 */
export function highlightedRow(rows: readonly PickerRow[], value: string | null, query: string, moved: number | null): number {
  if (moved !== null) return Math.min(moved, rows.length - 1)
  if (query !== '') return Math.min(1, rows.length - 1)
  const chosen = rows.findIndex((r) => r.kind === 'item' && r.counterparty.id === value)
  return Math.max(chosen, 0)
}

/** What Enter does on the open list: choose a row, leave the list open, or close it and keep the choice. */
export type EnterAction = { kind: 'choose'; row: PickerRow } | { kind: 'ignore' } | { kind: 'keep' }

export function enterAction(rows: readonly PickerRow[], value: string | null, query: string, moved: number | null): EnterAction {
  const row = rows[highlightedRow(rows, value, query, moved)]
  if (row.kind === 'none') {
    // Nothing matched what was typed: Enter must not clear the choice (a click on «none» still does).
    if (query !== '') return { kind: 'ignore' }
    // «none» is highlighted only because the chosen counterparty is not in the list (not loaded yet, archived, or past
    // the first options): Enter keeps it. Moving the highlight to «none» and pressing Enter still clears it.
    if (moved === null && value !== null) return { kind: 'keep' }
  }
  return { kind: 'choose', row }
}
