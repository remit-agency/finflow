'use client'

import { useEffect, useState } from 'react'
import { fetchRate, type RateInfo } from '@/lib/api/rates-client'
import { isDay } from '@/lib/domain/ledger/days'

export type RatePreview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; rate: number; rateDate: string }
  | { state: 'unavailable' }

const IDLE: RatePreview = { state: 'idle' }
const LOADING: RatePreview = { state: 'loading' }
const UNAVAILABLE: RatePreview = { state: 'unavailable' }
const DEBOUNCE_MS = 300

/**
 * The NBP rate to show next to an amount, only a hint (the server stores the real conversion). `from` is null
 * when no conversion is needed. A change of currency or date asks again after a short pause; an answer that
 * arrives for an earlier question is dropped. A failed or unavailable rate never blocks saving.
 */
export function useRatePreview(from: string | null, to: string, date: string): RatePreview {
  const enabled = from !== null && from !== to && isDay(date)
  const key = `${from}>${to}@${date}`
  const [result, setResult] = useState<{ key: string; info: RateInfo | null } | null>(null)

  useEffect(() => {
    if (!enabled || from === null) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchRate(from, to, date, controller.signal)
        .then((info) => setResult({ key, info }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key, info: null })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, from, to, date, key])

  if (!enabled) return IDLE
  if (result?.key !== key) return LOADING
  return result.info ? { state: 'ok', rate: result.info.rate, rateDate: result.info.rateDate } : UNAVAILABLE
}
