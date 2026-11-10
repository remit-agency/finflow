'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchPlanMatches, onRecurringChanged } from '@/lib/api/recurring-client'
import { readPlanDismissed, writePlanDismissed } from '@/lib/domain/recurring/dismissed'
import { keyOfMatch } from '@/lib/domain/recurring/match'
import type { MatchOutcome, MatchSuggestions, PlanMatch } from '@/lib/domain/recurring/types'
import { withDismissed } from '@/lib/domain/transfers/dismissed'
import { browserLocalStorage } from '@/lib/shell/sidebar-store'

const REFRESH_DEBOUNCE_MS = 300

export interface UsePlanMatches {
  /** The server's pairs without the ones turned down in this browser. */
  pairs: PlanMatch[]
  truncated: boolean
  dismiss: (pairs: readonly PlanMatch[]) => void
  refresh: () => void
  /** The pairs that went through leave the list at once; the failed ones stay. */
  settle: (outcomes: readonly MatchOutcome[]) => void
}

/**
 * The plan ↔ bank pairs the journal suggests (S11), for `orgId` (null: nothing is read, e.g. a viewer). Read when the
 * journal opens, on `refresh` and after a change of planned payments in this browser, never after an ordinary edit.
 * A failed read shows nothing: the banner is only a hint.
 */
export function usePlanMatches(orgId: string | null): UsePlanMatches {
  const [round, setRound] = useState(0)
  const [loaded, setLoaded] = useState<{ orgId: string; result: MatchSuggestions } | null>(null)
  const [dismissed, setDismissed] = useState<{ orgId: string; keys: string[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    const ac = new AbortController()
    fetchPlanMatches(orgId, ac.signal).then(
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
    const off = onRecurringChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [orgId])

  const keys = useMemo(
    () => (dismissed && dismissed.orgId === orgId ? dismissed.keys : orgId ? readPlanDismissed(browserLocalStorage(), orgId) : []),
    [orgId, dismissed],
  )
  const result = loaded && loaded.orgId === orgId ? loaded.result : null
  const pairs = useMemo(() => (result ? result.pairs.filter((p) => !keys.includes(keyOfMatch(p))) : []), [result, keys])

  const dismiss = useCallback(
    (gone: readonly PlanMatch[]) => {
      if (!orgId || gone.length === 0) return
      const next = withDismissed(readPlanDismissed(browserLocalStorage(), orgId), gone.map(keyOfMatch))
      writePlanDismissed(browserLocalStorage(), orgId, next)
      setDismissed({ orgId, keys: next })
    },
    [orgId],
  )
  const refresh = useCallback(() => setRound((r) => r + 1), [])
  const settle = useCallback(
    (outcomes: readonly MatchOutcome[]) => {
      const done = new Set(outcomes.flatMap((o) => (o.ok ? [o.planId] : [])))
      setLoaded((prev) => (prev && prev.orgId === orgId ? { ...prev, result: { ...prev.result, pairs: prev.result.pairs.filter((p) => !done.has(p.plan.id)) } } : prev))
    },
    [orgId],
  )

  return { pairs, truncated: result?.truncated ?? false, dismiss, refresh, settle }
}
