'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { fetchJournalPage, PAGE_SIZE } from '@/lib/api/journal-client'
import { onLedgerChanged } from '@/lib/api/ledger-events'
import { filtersToParams, type JournalFilters } from '@/lib/domain/journal/filter'
import { initialPaging, pagingReducer } from '@/lib/domain/journal/paging'
import type { JournalRow } from '@/lib/domain/journal/types'

const RELOAD_DEBOUNCE_MS = 300
const MAX_RELOAD_PAGES = 20

export interface UseJournalResult {
  rows: JournalRow[]
  loading: boolean
  error: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

/**
 * The journal pages for an org and filters. `filters` must keep its identity while its content does
 * (memoise it on the query string). Operations changed in this browser (forms, bulk actions, undo) reload
 * what is shown, to the same depth, without jumping back to the first page.
 */
export function useJournal(orgId: string | null, filters: JournalFilters): UseJournalResult {
  const key = `${orgId ?? ''}|${filtersToParams(filters).toString()}`
  const [state, dispatch] = useReducer(pagingReducer, key, initialPaging)
  const latest = useRef({ state, key })
  useEffect(() => {
    latest.current = { state, key }
  })

  // First page. Nothing is set synchronously: `loading` is derived from the key the rows belong to.
  useEffect(() => {
    if (!orgId) return
    const ac = new AbortController()
    fetchJournalPage(orgId, filters, null, { signal: ac.signal }).then(
      (page) => dispatch({ type: 'first', key, page }),
      () => {
        if (!ac.signal.aborted) dispatch({ type: 'fail', key })
      },
    )
    return () => ac.abort()
  }, [orgId, filters, key])

  const loadMore = useCallback(() => {
    const current = latest.current
    if (!orgId || current.key !== key || current.state.next === null || current.state.moreLoading || current.state.phase !== 'ready') return
    dispatch({ type: 'moreStart', key })
    fetchJournalPage(orgId, filters, current.state.next).then(
      (page) => dispatch({ type: 'more', key, page }),
      () => dispatch({ type: 'fail', key }),
    )
  }, [orgId, filters, key])

  // Reload to the depth the person has scrolled to, after this browser changed operations.
  useEffect(() => {
    if (!orgId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const reload = async () => {
      const { state: s, key: k } = latest.current
      if (k !== key || s.phase === 'loading') return
      const want = Math.max(s.rows.length, PAGE_SIZE)
      const rows: JournalRow[] = []
      let cursor: string | null = null
      for (let i = 0; i < MAX_RELOAD_PAGES; i++) {
        const page = await fetchJournalPage(orgId, filters, cursor)
        rows.push(...page.rows)
        cursor = page.next
        if (cursor === null || rows.length >= want) break
      }
      dispatch({ type: 'replace', key, rows, next: cursor })
    }
    const off = onLedgerChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void reload().catch(() => dispatch({ type: 'fail', key })), RELOAD_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [orgId, filters, key])

  const current = state.key === key
  return {
    rows: current ? state.rows : [],
    loading: !current || state.phase === 'loading',
    error: current && state.phase === 'error',
    hasMore: current && state.next !== null,
    loadingMore: current && state.moreLoading,
    loadMore,
  }
}
