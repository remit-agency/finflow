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
  /** The last «load more» failed; the rows stay and `loadMore` asks again. */
  moreError: boolean
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
  // Other filters or another company: start over for the new key (set during render, the documented way to reset
  // state on a changed input). Without it the reducer would ignore every answer for the new key.
  if (state.key !== key) dispatch({ type: 'begin', key })
  const latest = useRef({ state, key })
  useEffect(() => {
    latest.current = { state, key }
  })

  // The reload in flight (its id grows with every reload; only the latest may touch the list) and the «load more»
  // request in flight. Both are aborted when something newer replaces them.
  const reloadRef = useRef<{ id: number; ac: AbortController | null }>({ id: 0, ac: null })
  const moreRef = useRef<AbortController | null>(null)

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
    return () => {
      ac.abort()
      moreRef.current?.abort()
      moreRef.current = null
    }
  }, [orgId, filters, key])

  const loadMore = useCallback(() => {
    const { state: s, key: k } = latest.current
    // `moreRef` closes the gap before the next render: a second call right after the first must not start a request.
    if (!orgId || k !== key || s.next === null || s.moreLoading || s.phase !== 'ready' || moreRef.current) return
    const after = s.next
    const ac = new AbortController()
    moreRef.current = ac
    dispatch({ type: 'moreStart', key, after })
    fetchJournalPage(orgId, filters, after, { signal: ac.signal }).then(
      (page) => {
        if (moreRef.current === ac) moreRef.current = null
        if (!ac.signal.aborted) dispatch({ type: 'more', key, after, page })
      },
      () => {
        if (moreRef.current === ac) moreRef.current = null
        if (!ac.signal.aborted) dispatch({ type: 'failMore', key, after })
      },
    )
  }, [orgId, filters, key])

  // Reload to the depth the person has scrolled to, after this browser changed operations or when the tab comes
  // back to the front (a journal left open for hours catches up).
  useEffect(() => {
    if (!orgId) return
    const reloads = reloadRef.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const reload = async () => {
      const { state: s, key: k } = latest.current
      if (k !== key || s.phase === 'loading') return
      // Newer wins: the previous reload and a «load more» still in flight are cancelled, their answers are void.
      reloads.ac?.abort()
      moreRef.current?.abort()
      moreRef.current = null
      const ac = new AbortController()
      const id = ++reloads.id
      reloads.ac = ac
      const isLatest = () => reloads.id === id && !ac.signal.aborted
      try {
        const want = Math.max(s.rows.length, PAGE_SIZE)
        const rows: JournalRow[] = []
        let cursor: string | null = null
        for (let i = 0; i < MAX_RELOAD_PAGES; i++) {
          const page = await fetchJournalPage(orgId, filters, cursor, { signal: ac.signal })
          if (!isLatest()) return
          rows.push(...page.rows)
          cursor = page.next
          if (cursor === null || rows.length >= want) break
        }
        if (isLatest()) dispatch({ type: 'replace', key, rows, next: cursor })
      } catch {
        if (isLatest()) dispatch({ type: 'fail', key })
      } finally {
        if (reloads.ac === ac) reloads.ac = null
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    const off = onLedgerChanged(schedule)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(timer)
      reloads.id++
      reloads.ac?.abort()
      reloads.ac = null
    }
  }, [orgId, filters, key])

  const current = state.key === key
  return {
    rows: current ? state.rows : [],
    loading: !current || state.phase === 'loading',
    error: current && state.phase === 'error',
    hasMore: current && state.next !== null,
    loadingMore: current && state.moreLoading,
    moreError: current && state.moreError,
    loadMore,
  }
}
