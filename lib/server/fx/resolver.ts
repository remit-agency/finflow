import { addDays, isDay, monthBounds, monthOf, prevMonth } from '@/lib/server/fx/days'
import { crossRate, isCurrencyCode, pickTable, round8, validateRefresh } from '@/lib/server/fx/rates'
import type { FxStore } from '@/lib/server/fx/store'
import { FxError, type MonthDoc, type NbpTable, type RateSnapshot } from '@/lib/server/fx/types'

const HOUR_MS = 3_600_000
/** After a failed refresh of a month NBP is left alone for this long. */
const FAILURE_MEMO_MS = 30_000
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

/**
 * Keep one resolver per process: its in-memory state (finished months, refreshes in flight, the
 * failure memo) only helps when it lives across requests.
 */
export function createResolver(deps: FxDeps) {
  /** Complete months never change, so they are kept for good. */
  const completeMonths = new Map<string, MonthDoc>()
  /** One refresh per month at a time: concurrent callers share its NBP fetch and store write. */
  const inFlight = new Map<string, Promise<MonthDoc>>()
  /** Month -> epoch ms of its last failed refresh. */
  const failedAt = new Map<string, number>()

  async function readCache(month: string): Promise<MonthDoc | null> {
    try {
      return await deps.store.get(month)
    } catch (e) {
      console.error('fx cache read failed', { name: (e as Error)?.name })
      return null
    }
  }

  /**
   * A cached month answers `day` without NBP when it is complete, was fetched on or after `day`
   * (every table before `day` was published before that fetch day ended), or is under an hour old.
   */
  function usable(doc: MonthDoc, day: string): boolean {
    return doc.complete || doc.fetchedDay >= day || deps.now() - doc.fetchedAt < HOUR_MS
  }

  async function refresh(month: string, cached: MonthDoc | null): Promise<MonthDoc> {
    const known = completeMonths.get(month)
    if (known) return known
    const running = inFlight.get(month)
    if (running) return running

    const failure = failedAt.get(month)
    if (failure !== undefined && deps.now() - failure < FAILURE_MEMO_MS) throw new FxError('provider_unavailable')

    const run = (async (): Promise<MonthDoc> => {
      try {
        const today = deps.today()
        const { first, last } = monthBounds(month)
        const finished = last < today
        const tables = await deps.fetchTables(first, finished ? last : today)
        // A worse reply (lost days, a gap, an empty finished month) must never replace a good cache.
        validateRefresh(tables, cached?.tables ?? [], finished)
        const doc: MonthDoc = { month, tables, fetchedAt: deps.now(), fetchedDay: today, complete: finished }
        try {
          await deps.store.set(doc)
        } catch (e) {
          console.error('fx cache write failed', { name: (e as Error)?.name })
        }
        if (finished) completeMonths.set(month, doc)
        failedAt.delete(month)
        return doc
      } catch (e) {
        failedAt.set(month, deps.now())
        throw e instanceof FxError ? e : new FxError('provider_unavailable')
      }
    })()
    inFlight.set(month, run)
    try {
      return await run
    } finally {
      inFlight.delete(month)
    }
  }

  async function loadMonth(month: string, day: string): Promise<MonthDoc> {
    const { first } = monthBounds(month)
    // NBP answers 400 for a range that reaches into the future: such a month has nothing yet.
    if (first > deps.today()) return { month, tables: [], fetchedAt: deps.now(), fetchedDay: deps.today(), complete: false }

    const known = completeMonths.get(month)
    if (known) return known

    const cached = await readCache(month)
    if (cached && usable(cached, day)) {
      if (cached.complete) completeMonths.set(month, cached)
      return cached
    }

    try {
      return await refresh(month, cached)
    } catch (e) {
      // A stale month is safe to serve only when it is certain to hold the answer for `day`.
      if (cached && (cached.fetchedDay >= day || cached.tables.some((t) => t.effectiveDate >= day))) return cached
      throw e
    }
  }

  return async function resolveRate(from: string, to: string, date: string): Promise<RateSnapshot> {
    if (!isCurrencyCode(from) || !isCurrencyCode(to) || !isDay(date)) throw new FxError('invalid_params')
    const today = deps.today()
    if (date > addDays(today, 366)) throw new FxError('invalid_params')

    if (from === to) {
      return { rate: 1, from, to, requestedDate: date, rateDate: date, tableNo: null, source: 'identity', final: true }
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
          final: date <= today,
        }
      }
      month = prevMonth(month)
    }
    throw new FxError('no_rate_before')
  }
}
