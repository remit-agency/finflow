'use client'

import { useState } from 'react'
import { selectionForScope, type ScopedSelection } from '@/lib/domain/journal/selection'

const EMPTY: ReadonlySet<string> = new Set()

/** The checked rows. The selection belongs to a scope (the filters) and is emptied for good when the scope changes. */
export function useJournalSelection(scope: string) {
  const [stored, setStored] = useState<ScopedSelection>({ scope, ids: EMPTY })
  // Adjusting state while rendering (the documented way to reset state on a changed input): React re-renders at once
  // with the emptied state, and the old scope's ids are gone, not just hidden.
  const state = selectionForScope(stored, scope)
  if (state !== stored) setStored(state)
  const ids = state.ids
  const set = (next: ReadonlySet<string>) => setStored({ scope, ids: next })
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
