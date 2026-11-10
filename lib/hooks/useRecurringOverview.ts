'use client'

import { useCallback, useEffect, useState } from 'react'
import { onLedgerChanged } from '@/lib/api/ledger-events'
import { fetchRecurringOverview, onRecurringChanged } from '@/lib/api/recurring-client'
import type { RecurringOverview } from '@/lib/domain/recurring/types'

/** Several changes in a row (an undo of many) read the overview once. */
const REFRESH_DEBOUNCE_MS = 300

export interface UseRecurringOverview {
  overview: RecurringOverview | null
  /** The last read failed (the last good answer, if any, stays). */
  error: boolean
  refresh: () => void
}

/** The page «Планові платежі» (S11): read on open, on `refresh` and after any change in this browser (a plan, a series, a match). */
export function useRecurringOverview(orgId: string): UseRecurringOverview {
  const [round, setRound] = useState(0)
  const [state, setState] = useState<{ orgId: string; overview: RecurringOverview | null; error: boolean } | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    fetchRecurringOverview(orgId, ac.signal).then(
      (overview) => {
        if (!ac.signal.aborted) setState({ orgId, overview, error: false })
      },
      () => {
        if (!ac.signal.aborted) setState((prev) => ({ orgId, overview: prev?.orgId === orgId ? prev.overview : null, error: true }))
      },
    )
    return () => ac.abort()
  }, [orgId, round])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    }
    const offRecurring = onRecurringChanged(bump)
    const offLedger = onLedgerChanged(bump)
    return () => {
      offRecurring()
      offLedger()
      clearTimeout(timer)
    }
  }, [orgId])

  const refresh = useCallback(() => setRound((r) => r + 1), [])
  const current = state !== null && state.orgId === orgId ? state : null
  return { overview: current?.overview ?? null, error: current?.error ?? false, refresh }
}
