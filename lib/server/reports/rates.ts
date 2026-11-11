// lib/server/reports/rates.ts
import { rateKey } from '@/lib/domain/reports/reconcile'
import type { RateNeed, RateQuote } from '@/lib/domain/reports/types'
import { FxError } from '@/lib/server/fx/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'

/**
 * The NBP rates a report needs, each distinct (currency, day) asked once: the memo of one request, gone with its response
 * (the months behind them stay in the resolver's own process cache, S04). A rate NBP cannot give (no table before the day,
 * an unknown currency, NBP down) is left out, so the reconciliation names it instead of the whole report failing.
 */
export async function quoteRates(resolve: LedgerDeps['resolveRate'], baseCurrency: string, needs: readonly RateNeed[]): Promise<Map<string, RateQuote>> {
  const book = new Map<string, RateQuote>()
  const distinct = new Map(needs.map((n) => [rateKey(n.currency, n.date), n]))
  await Promise.all(
    [...distinct].map(async ([key, n]) => {
      try {
        const s = await resolve(n.currency, baseCurrency, n.date)
        book.set(key, { rate: s.rate, rateDate: s.rateDate, tableNo: s.tableNo, final: s.final })
      } catch (e) {
        if (!(e instanceof FxError)) throw e
      }
    }),
  )
  return book
}
