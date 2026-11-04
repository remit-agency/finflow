/** Rows a flat list shows at most; the search narrows the rest. A tree is never cut (see `listWindow`). */
export const MAX_LIST_ROWS = 100

/**
 * The rows an open list shows of its matches, and how many it leaves out. A flat list is cut at `MAX_LIST_ROWS`. A tree is the
 * list's whole content, so it is never cut: its last rows (the uncategorised rows and the transfers) must stay in view however
 * many categories the company has.
 */
export function listWindow<T>(matches: readonly T[], tree: boolean): { shown: readonly T[]; hidden: number } {
  if (tree) return { shown: matches, hidden: 0 }
  return { shown: matches.slice(0, MAX_LIST_ROWS), hidden: Math.max(0, matches.length - MAX_LIST_ROWS) }
}

/**
 * The state an arrow key asks for a tree row: ArrowRight opens it, ArrowLeft closes it (`true` / `false`). The keys act only
 * while the search is empty: once something is typed the arrows move the caret, and the closed rows are shown during a search
 * anyway. `undefined` when the key does nothing here (a row without children, a row already in that state, another key).
 */
export function arrowExpandTarget(key: string, query: string, expanded: boolean | undefined): boolean | undefined {
  if (query !== '' || expanded === undefined) return undefined
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return undefined
  const wantOpen = key === 'ArrowRight'
  return expanded === wantOpen ? undefined : wantOpen
}
