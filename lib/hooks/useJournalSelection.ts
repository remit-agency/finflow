'use client'

import { useState } from 'react'

const EMPTY: ReadonlySet<string> = new Set()

/** The checked rows. The selection belongs to a scope (the filters) and is empty again when the scope changes. */
export function useJournalSelection(scope: string) {
  const [state, setState] = useState<{ scope: string; ids: ReadonlySet<string> }>({ scope, ids: EMPTY })
  const ids = state.scope === scope ? state.ids : EMPTY
  const set = (next: ReadonlySet<string>) => setState({ scope, ids: next })
  return {
    ids,
    has: (id: string) => ids.has(id),
    toggle: (id: string) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      set(next)
    },
    add: (list: string[]) => set(new Set([...ids, ...list])),
    remove: (list: string[]) => set(new Set([...ids].filter((id) => !list.includes(id)))),
    clear: () => set(EMPTY),
  }
}
