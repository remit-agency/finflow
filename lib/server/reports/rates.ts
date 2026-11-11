// lib/server/reports/rates.ts
import { ReportError } from '@/lib/domain/reports/errors'
import { rateKey } from '@/lib/domain/reports/reconcile'
import type { RateNeed, RateQuote } from '@/lib/domain/reports/types'
import { FxError } from '@/lib/server/fx/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'

/** NBP requests one report request has in flight at a time: a long period is a queue of them, not a burst. */
export const RATE_CONCURRENCY = 4
/**
 * The distinct rates one request may value (a balance and a movement day each): a period of more is refused before NBP is
 * asked, so a report cannot fetch the tables of more months than this (the resolver caches them, S04, and writes them).
 */
export const MAX_RATE_LOOKUPS = 400

/**
 * The NBP rates a report needs, each distinct (currency, day) asked once, `RATE_CONCURRENCY` at a time: the memo of one
 * request, gone with its response (the months behind them stay in the resolver's own process cache, S04). A rate NBP cannot
 * give (no table before the day, an unknown currency, NBP down) is left out, so the reconciliation names it instead of the
 * whole report failing.
 */
export async function quoteRates(resolve: LedgerDeps['resolveRate'], baseCurrency: string, needs: readonly RateNeed[]): Promise<Map<string, RateQuote>> {
  const book = new Map<string, RateQuote>()
  const distinct = [...new Map(needs.map((n) => [rateKey(n.currency, n.date), n])).entries()]
  if (distinct.length > MAX_RATE_LOOKUPS) throw new ReportError('too_many_rates', { cap: MAX_RATE_LOOKUPS })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < distinct.length) {
      const [key, n] = distinct[next++]
      try {
        const s = await resolve(n.currency, baseCurrency, n.date)
        book.set(key, { rate: s.rate, rateDate: s.rateDate, tableNo: s.tableNo, final: s.final })
      } catch (e) {
        if (!(e instanceof FxError)) throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RATE_CONCURRENCY, distinct.length) }, worker))
  return book
}
