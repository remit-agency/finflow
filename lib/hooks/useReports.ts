'use client'

import { useCallback, useEffect, useState } from 'react'
import { onLedgerChanged } from '@/lib/api/ledger-events'
import { fetchBalances, fetchCashFlow, fetchPL, viewOfFailure, type ServerView } from '@/lib/api/reports-client'
import { parseReportQuery, reportQueryToParams } from '@/lib/domain/reports/query'
import type { BalancesReport, CashFlowReport, PLReport, ReportQuery } from '@/lib/domain/reports/types'

/** Several changes in a row (an undo of many) read the report once. */
const REFRESH_DEBOUNCE_MS = 300

export interface ServerRead<T> {
  view: ServerView<T>
  /** Reads again (the retry button); what is shown stays until the new answer arrives. */
  refresh: () => void
}

// A key is the company and the address of the read; the readers are module functions, so an effect depends on the key only.
const keyOf = (orgId: string, rest: string): string => `${encodeURIComponent(orgId)}|${rest}`
function partsOf(key: string): [string, string] {
  const bar = key.indexOf('|')
  return [decodeURIComponent(key.slice(0, bar)), key.slice(bar + 1)]
}
// Async, so a query the parser refuses (a period over the report length) is a rejection the view shows, not a throw in the effect.
export const readCashFlowOf = async (key: string, signal: AbortSignal): Promise<CashFlowReport> => {
  const [orgId, params] = partsOf(key)
  return fetchCashFlow(orgId, parseReportQuery(new URLSearchParams(params)), signal)
}
export const readPLOf = async (key: string, signal: AbortSignal): Promise<PLReport> => {
  const [orgId, params] = partsOf(key)
  return fetchPL(orgId, parseReportQuery(new URLSearchParams(params)), signal)
}
const readBalancesOf = (key: string, signal: AbortSignal): Promise<BalancesReport> => {
  const [orgId, date] = partsOf(key)
  return fetchBalances(orgId, date, signal)
}

/** A counter that a change in this browser bumps (debounced): every server read below reads again. */
function useLedgerRound(): [number, () => void] {
  const [round, setRound] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onLedgerChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])
  const refresh = useCallback(() => setRound((r) => r + 1), [])
  return [round, refresh]
}

function useServerRead<T>(key: string | null, round: number, read: (key: string, signal: AbortSignal) => Promise<T>): ServerView<T> {
  const [state, setState] = useState<{ key: string; view: ServerView<T> } | null>(null)
  useEffect(() => {
    if (key === null) return
    const ac = new AbortController()
    read(key, ac.signal).then(
      (data) => {
        if (!ac.signal.aborted) setState({ key, view: { status: 'ready', data } })
      },
      (e: unknown) => {
        if (!ac.signal.aborted) setState({ key, view: viewOfFailure(e) })
      },
    )
    return () => ac.abort()
  }, [key, round, read])
  return state !== null && state.key === key ? state.view : { status: 'loading' }
}

/** Cash Flow of the server for the query (null: not yet, e.g. while the categories load). */
export function useCashFlowReport(orgId: string, query: ReportQuery | null): ServerRead<CashFlowReport> {
  const [round, refresh] = useLedgerRound()
  const key = query === null ? null : keyOf(orgId, reportQueryToParams(query).toString())
  return { view: useServerRead(key, round, readCashFlowOf), refresh }
}

export function usePLReport(orgId: string, query: ReportQuery | null): ServerRead<PLReport> {
  const [round, refresh] = useLedgerRound()
  const key = query === null ? null : keyOf(orgId, reportQueryToParams(query).toString())
  return { view: useServerRead(key, round, readPLOf), refresh }
}

export function useBalances(orgId: string, date: string): ServerRead<BalancesReport> {
  const [round, refresh] = useLedgerRound()
  return { view: useServerRead(keyOf(orgId, date), round, readBalancesOf), refresh }
}
