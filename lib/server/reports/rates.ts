// lib/server/reports/rates.ts
import { addDays, monthOf } from '@/lib/domain/ledger/days'
import { rateKey } from '@/lib/domain/reports/reconcile'
import { MAX_RATE_MONTHS, type RateNeed, type RateQuote } from '@/lib/domain/reports/types'
import { FxError } from '@/lib/server/fx/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'

/** NBP requests one report request has in flight at a time: a long period is a queue of them, not a burst. */
export const RATE_CONCURRENCY = 4

/** The NBP month table a rate is read from: the resolver reads the month before the day it is asked for (the 1st included). */
export function tableMonthOf(date: string): string {
  return monthOf(addDays(date, -1))
}

export interface QuotedRates {
  book: Map<string, RateQuote>
  /** The distinct needs not asked of NBP because they lie past the month bound: left unvalued, never guessed. */
  unrequested: RateNeed[]
}

/**
 * The NBP rates a report needs, each distinct (currency, day) asked once, `RATE_CONCURRENCY` at a time: the memo of one
 * request, gone with its response (the months behind them stay in the resolver's own process cache, S04). The work is bounded
 * by the distinct NBP month tables, in the order the needs come (the caller puts the valuations of the balances first): the
 * rates of the first `months` months are asked, the rest are counted in `unrequested` and not asked. A rate NBP cannot give
 * (no table before the day, an unknown currency, NBP down) is left out too; the reconciliation names both kinds (`missingRates`).
 */
export async function quoteRates(
  resolve: LedgerDeps['resolveRate'],
  baseCurrency: string,
  needs: readonly RateNeed[],
  months: number = MAX_RATE_MONTHS,
): Promise<QuotedRates> {
  const book = new Map<string, RateQuote>()
  const distinct = [...new Map(needs.map((n) => [rateKey(n.currency, n.date), n])).values()]
  const order = new Set(distinct.map((n) => tableMonthOf(n.date)))
  const allowed = new Set([...order].slice(0, months))
  const asked = distinct.filter((n) => allowed.has(tableMonthOf(n.date)))
  const unrequested = distinct.filter((n) => !allowed.has(tableMonthOf(n.date)))
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < asked.length) {
      const n = asked[next++]
      try {
        const s = await resolve(n.currency, baseCurrency, n.date)
        book.set(rateKey(n.currency, n.date), { rate: s.rate, rateDate: s.rateDate, tableNo: s.tableNo, final: s.final })
      } catch (e) {
        if (!(e instanceof FxError)) throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RATE_CONCURRENCY, asked.length) }, worker))
  return { book, unrequested }
}
