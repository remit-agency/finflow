'use client'

import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { onLedgerChanged } from '@/lib/api/ledger-events'
import { onRecurringChanged } from '@/lib/api/recurring-client'

/** Several changes in a row (an undo of many) read once. */
const REFRESH_DEBOUNCE_MS = 300

export interface RecurringRead<T> {
  /** The answer to this `key`; null while it is being read. */
  data: T | null
  /** The last good answer of this company, for any `key`: what a screen keeps showing (dimmed) while another key is read. */
  last: T | null
  /** The last read failed (the last good answer, if any, stays). */
  error: boolean
  refresh: () => void
}

/**
 * A read of the planned payments (S11, S12e): on open, when `orgId` or `key` changes (the read's own input, a period), on
 * `refresh` and after any change in this browser (a plan, a series, a match). `fetcher` must read what `key` names.
 */
export function useRecurringRead<T>(orgId: string, key: string, fetcher: (signal: AbortSignal) => Promise<T>): RecurringRead<T> {
  const [round, setRound] = useState(0)
  // The read is named by `orgId` and `key`: a new `fetcher` on each render must not read again.
  const run = useEffectEvent(fetcher)
  const [state, setState] = useState<{ orgId: string; key: string; data: T | null; error: boolean } | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    run(ac.signal).then(
      (data) => {
        if (!ac.signal.aborted) setState({ orgId, key, data, error: false })
      },
      () => {
        if (!ac.signal.aborted) setState((prev) => ({ orgId, key, data: prev?.orgId === orgId ? prev.data : null, error: true }))
      },
    )
    return () => ac.abort()
  }, [orgId, key, round])

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
  const sameOrg = state !== null && state.orgId === orgId ? state : null
  const current = sameOrg !== null && sameOrg.key === key ? sameOrg : null
  return { data: current?.data ?? null, last: sameOrg?.data ?? null, error: current?.error ?? false, refresh }
}
