'use client'

import { useEffect, useState } from 'react'
import { getTags } from '@/lib/firebase/tags'
import type { Tag } from '@/lib/domain/tags/types'

const EMPTY: Tag[] = []

export interface UseTagsResult {
  tags: Tag[]
  loading: boolean
}

/** The company's tags, live and in name order; the archived ones too (old operations still show them). */
export function useTags(orgId: string | null): UseTagsResult {
  // Stored with its company, so a company switch never shows the previous company's tags while the new
  // subscription waits for its first snapshot (same approach as useCounterparties).
  const [snapshot, setSnapshot] = useState<{ orgId: string; list: Tag[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    return getTags(orgId, (list) => setSnapshot({ orgId, list }))
  }, [orgId])

  const current = orgId !== null && snapshot?.orgId === orgId
  return { tags: current ? snapshot.list : EMPTY, loading: orgId !== null && !current }
}
