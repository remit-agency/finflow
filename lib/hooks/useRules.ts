'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchRules } from '@/lib/api/rules-client'
import type { ListedRule } from '@/lib/domain/rules/types'

const EMPTY: ListedRule[] = []

interface Loaded {
  orgId: string
  rules: ListedRule[]
}

/** The newest read to settle: which company and which `reload` it answered, and whether it failed. */
interface Settled {
  orgId: string
  tick: number
  failed: boolean
}

/**
 * The company's rules as the server lists them (in order, with the «неробоче» marks); `reload` after a change.
 * `refreshing` is true until the read asked for by the latest `reload` (or the company's first read) has settled:
 * the list on screen may then be older than the last change, so an order change must wait for it.
 */
export function useRules(orgId: string) {
  // Stored with its company, so a company switch never shows the previous company's rules.
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    fetchRules(orgId, controller.signal).then(
      (rules) => {
        if (controller.signal.aborted) return
        setLoaded({ orgId, rules })
        setSettled({ orgId, tick, failed: false })
      },
      () => {
        if (!controller.signal.aborted) setSettled({ orgId, tick, failed: true })
      },
    )
    return () => controller.abort()
  }, [orgId, tick])

  const rules = loaded !== null && loaded.orgId === orgId ? loaded.rules : null
  const failed = settled !== null && settled.orgId === orgId && settled.failed
  const refreshing = settled === null || settled.orgId !== orgId || settled.tick !== tick
  return { rules: rules ?? EMPTY, loading: rules === null && !failed, error: rules === null && failed, refreshing, reload }
}
