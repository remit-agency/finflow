'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchBankStatus, onBankChanged } from '@/lib/api/bank-client'
import type { BankStatus } from '@/lib/domain/banking/status-types'

interface State {
  status: BankStatus | null
  loading: boolean
  error: boolean
}

/** The company's bank connections, read from the server; reloads when the tab comes back and when bank data changed. */
export function useBankStatus(orgId: string, enabled = true) {
  const [state, setState] = useState<State>({ status: null, loading: enabled, error: false })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetchBankStatus(orgId, controller.signal).then(
      (status) => setState({ status, loading: false, error: false }),
      () => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, loading: false, error: true }))
      },
    )
    return () => controller.abort()
  }, [orgId, enabled, tick])

  useEffect(() => onBankChanged(refresh), [refresh])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  return { ...state, refresh }
}
