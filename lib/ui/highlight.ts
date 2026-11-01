/**
 * The highlighted row of an open list, or -1 for none (S10t; shared by TagPicker and the report filters of S10f). `moved` is
 * the row the person moved the highlight to (arrows or a real pointer move), or null while they have not. With a typed query
 * the first row is highlighted; without one nothing is, so Enter right after the list opens cannot choose a row by accident.
 * A moved highlight is clamped, because a narrower query can shorten the list under it.
 */
export function highlightedRow(count: number, query: string, moved: number | null): number {
  if (count === 0) return -1
  if (moved !== null) return Math.min(moved, count - 1)
  return query !== '' ? 0 : -1
}
