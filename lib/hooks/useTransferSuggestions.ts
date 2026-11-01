'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTransferSuggestions, onTransfersChanged } from '@/lib/api/transfers-client'
import { pairKey, readDismissed, withDismissed, writeDismissed } from '@/lib/domain/transfers/dismissed'
import type { SuggestionsResult, TransferSuggestion } from '@/lib/domain/transfers/types'
import { browserLocalStorage } from '@/lib/shell/sidebar-store'

/** Several transfer actions in a row (an undo of many) read the suggestions once. */
const REFRESH_DEBOUNCE_MS = 300

export interface UseTransferSuggestions {
  /** The server's suggestions without the pairs turned down in this browser. */
  pairs: TransferSuggestion[]
  truncated: boolean
  /** Remembers the pairs the person turned down (this browser only). */
  dismiss: (pairs: readonly TransferSuggestion[]) => void
  /** Reads the suggestions again (the dialog opens). */
  refresh: () => void
}

/**
 * The own transfers the journal suggests (S10b), for `orgId` (null: nothing is read, e.g. a viewer). Read when the journal
 * opens, on `refresh` and after transfer actions in this browser, never after an ordinary edit (each read costs up to 2000
 * document reads). A failed read shows nothing: the banner is only a hint.
 */
export function useTransferSuggestions(orgId: string | null): UseTransferSuggestions {
  const [round, setRound] = useState(0)
  const [loaded, setLoaded] = useState<{ orgId: string; result: SuggestionsResult } | null>(null)
  const [dismissed, setDismissed] = useState<{ orgId: string; keys: string[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    const ac = new AbortController()
    fetchTransferSuggestions(orgId, ac.signal).then(
      (result) => {
        if (!ac.signal.aborted) setLoaded({ orgId, result })
      },
      () => {
        // A hint only: a failed read leaves the last answer (or none) in place.
      },
    )
    return () => ac.abort()
  }, [orgId, round])

  useEffect(() => {
    if (!orgId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onTransfersChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [orgId])

  const keys = useMemo(
    () => (dismissed && dismissed.orgId === orgId ? dismissed.keys : orgId ? readDismissed(browserLocalStorage(), orgId) : []),
    [orgId, dismissed],
  )
  const result = loaded && loaded.orgId === orgId ? loaded.result : null
  const pairs = useMemo(() => (result ? result.pairs.filter((p) => !keys.includes(pairKey(p))) : []), [result, keys])

  const dismiss = useCallback(
    (gone: readonly TransferSuggestion[]) => {
      if (!orgId || gone.length === 0) return
      const next = withDismissed(readDismissed(browserLocalStorage(), orgId), gone.map(pairKey))
      writeDismissed(browserLocalStorage(), orgId, next)
      setDismissed({ orgId, keys: next })
    },
    [orgId],
  )
  const refresh = useCallback(() => setRound((r) => r + 1), [])

  return { pairs, truncated: result?.truncated ?? false, dismiss, refresh }
}
