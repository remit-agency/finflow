'use client'

import { useEffect, useState } from 'react'
import { getCounterparties } from '@/lib/firebase/counterparties'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const EMPTY: Counterparty[] = []

export interface UseCounterpartiesResult {
  counterparties: Counterparty[]
  loading: boolean
}

export function useCounterparties(orgId: string | null): UseCounterpartiesResult {
  // Stored with its company, so a company switch never shows the previous company's list while the new
  // subscription waits for its first snapshot (same approach as useAccounts).
  const [snapshot, setSnapshot] = useState<{ orgId: string; list: Counterparty[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    return getCounterparties(orgId, (list) => setSnapshot({ orgId, list }))
  }, [orgId])

  const current = orgId !== null && snapshot?.orgId === orgId
  return { counterparties: current ? snapshot.list : EMPTY, loading: orgId !== null && !current }
}
