import { addDays, isDay, monthBounds, monthOf, prevMonth } from '@/lib/server/fx/days'
import { crossRate, pickTable, round8 } from '@/lib/server/fx/rates'
import type { FxStore } from '@/lib/server/fx/store'
import { FxError, type MonthDoc, type NbpTable, type RateSnapshot } from '@/lib/server/fx/types'

const HOUR_MS = 3_600_000
const CODE = /^[A-Z]{3}$/
// First month with published tables (2002-01-02).
const FIRST_MONTH = '2002-01'

export type FxDeps = {
  store: FxStore
  fetchTables: (fromDay: string, toDay: string) => Promise<NbpTable[]>
  /** Epoch ms. */
  now: () => number
  /** Warsaw calendar day, YYYY-MM-DD. */
  today: () => string
}

export function createResolver(deps: FxDeps) {
  async function loadMonth(month: string, day: string): Promise<MonthDoc> {
    const today = deps.today()
    const { first, last } = monthBounds(month)
    // NBP answers 400 for a range that reaches into the future: such a month has nothing yet.
    if (first > today) return { month, tables: [], fetchedAt: deps.now(), complete: false }

    const cached = await deps.store.get(month)
    if (cached && (cached.complete || deps.now() - cached.fetchedAt < HOUR_MS)) return cached

    const finished = last < today
    try {
      const tables = await deps.fetchTables(first, finished ? last : today)
      // A finished month always has tables; empty means NBP misbehaved, so do not cache it forever.
      if (finished && tables.length === 0) throw new FxError('provider_unavailable')
      const doc: MonthDoc = { month, tables, fetchedAt: deps.now(), complete: finished }
      try {
        await deps.store.set(doc)
      } catch (e) {
        console.error('fx cache write failed', { name: (e as Error)?.name })
      }
      return doc
    } catch (e) {
      // A stale month is safe to serve only if it already holds a table on or after `day`.
      if (cached && cached.tables.some((t) => t.effectiveDate >= day)) return cached
      throw e instanceof FxError ? e : new FxError('provider_unavailable')
    }
  }

  return async function resolveRate(from: string, to: string, date: string): Promise<RateSnapshot> {
    if (!CODE.test(from) || !CODE.test(to) || !isDay(date)) throw new FxError('invalid_params')
    if (date > addDays(deps.today(), 366)) throw new FxError('invalid_params')

    if (from === to) {
      return { rate: 1, from, to, requestedDate: date, rateDate: date, tableNo: null, source: 'identity' }
    }

    let month = monthOf(addDays(date, -1))
    while (month >= FIRST_MONTH) {
      const doc = await loadMonth(month, date)
      const table = pickTable(doc.tables, date)
      if (table) {
        return {
          rate: round8(crossRate(table, from, to)),
          from,
          to,
          requestedDate: date,
          rateDate: table.effectiveDate,
          tableNo: table.no,
          source: 'NBP_A',
        }
      }
      month = prevMonth(month)
    }
    throw new FxError('no_rate_before')
  }
}
