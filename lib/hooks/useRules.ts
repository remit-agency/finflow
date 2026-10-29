'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchRules } from '@/lib/api/rules-client'
import type { ListedRule } from '@/lib/domain/rules/types'

const EMPTY: ListedRule[] = []

interface Loaded {
  orgId: string
  rules: ListedRule[]
}

/** The company's rules as the server lists them (in order, with the «неробоче» marks); `reload` after a change. */
export function useRules(orgId: string) {
  // Stored with its company, so a company switch never shows the previous company's rules.
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    fetchRules(orgId, controller.signal).then(
      (rules) => {
        setLoaded({ orgId, rules })
        setFailedFor(null)
      },
      () => {
        if (!controller.signal.aborted) setFailedFor(orgId)
      },
    )
    return () => controller.abort()
  }, [orgId, tick])

  const rules = loaded !== null && loaded.orgId === orgId ? loaded.rules : null
  return { rules: rules ?? EMPTY, loading: rules === null && failedFor !== orgId, error: rules === null && failedFor === orgId, reload }
}
