'use client'

import { useEffect, useState } from 'react'
import { fetchRate } from '@/lib/api/rates-client'
import { valuationDate } from '@/lib/domain/reports/reconcile'
import { todayDay } from '@/lib/utils/today'

/** How often the Warsaw day is checked: the rate of «tomorrow» (the Balance rule) changes when the day does. */
const DAY_CHECK_MS = 60_000
const NO_RATES: ReadonlyMap<string, number> = new Map()

export interface SidebarRates {
  /** The NBP rate into the company currency of each currency that has one; a currency missing here has no rate. */
  rates: ReadonlyMap<string, number>
  /** False while the rates of the current currencies and day are still being read. */
  ready: boolean
}

interface SidebarRead {
  key: string
  companyCurrency: string
  rates: ReadonlyMap<string, number>
}

/**
 * The NBP rates of the sidebar total (S04): one `GET /api/rates` per foreign currency, valued like the Balance report
 * (`valuationDate` of today). Asked again only when the company currency, the set of foreign currencies or the Warsaw
 * day changes, never on a balance change. A failed rate is absent and is not retried before one of those changes.
 * While the new rates load, the rates of the same company are kept (the total stays near its value and `ready` is
 * false), so a change never shows a partial sum without a hint.
 */
export function useSidebarRates(companyCurrency: string, currencies: readonly string[]): SidebarRates {
  const [today, setToday] = useState(() => todayDay())
  const list = currencies.join(',')
  const needed = companyCurrency !== '' && list !== ''
  const key = `${companyCurrency}|${list}|${today}`
  const [read, setRead] = useState<SidebarRead | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setToday(todayDay()), DAY_CHECK_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!needed) return undefined
    const controller = new AbortController()
    const day = valuationDate(today)
    const requests = list.split(',').map((currency) =>
      fetchRate(currency, companyCurrency, day, controller.signal).then(
        (info) => (info === null ? null : ([currency, info.rate] as const)),
        () => null,
      ),
    )
    void Promise.all(requests).then((pairs) => {
      if (controller.signal.aborted) return
      setRead({ key, companyCurrency, rates: new Map(pairs.filter((pair) => pair !== null)) })
    })
    return () => controller.abort()
  }, [needed, key, companyCurrency, list, today])

  const sameCompany = read !== null && read.companyCurrency === companyCurrency ? read : null
  return {
    rates: sameCompany?.rates ?? NO_RATES,
    ready: !needed || (read !== null && read.key === key),
  }
}
