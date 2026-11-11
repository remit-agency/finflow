// The two paths of a report are one function (S12): for random companies (tests/unit/domain/ledger/model.ts) the Cash Flow
// and the P&L of whole months from the incrementally kept rollups equal the ones recomputed from the operations; the
// reconciliation adds up to the minor unit for random periods and filters; the order of the operations changes nothing.
import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { categoryTypesOf } from '@/lib/domain/analytics-filter/kinds'
import { matchesSharedChoices } from '@/lib/domain/journal/filter'
import { addDays, monthBounds, monthOf } from '@/lib/domain/ledger/days'
import { datedEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { buildCashFlowCore } from '@/lib/domain/reports/cashflow'
import { factsFromRollupDocs, operationRollups, selectRollupDocs, type DayRange } from '@/lib/domain/reports/facts'
import { buildPLCore } from '@/lib/domain/reports/pl'
import { rateKey, ratesForReconciliation, reconcile, reconciliationDays } from '@/lib/domain/reports/reconcile'
import type { RateNeed, RateQuote } from '@/lib/domain/reports/types'
import { ACCOUNTS, BASE, Model, TODAY, randomTx, rng } from '../ledger/model'

// ci2 is gone and ce2 is now an income category: their operations count as uncategorised (kindRowOf).
const TYPES = categoryTypesOf([
  { id: 'ci1', type: 'income' },
  { id: 'ce1', type: 'expense' },
  { id: 'ce2', type: 'income' },
])
const IDS = ACCOUNTS.map((a) => a.id)

function companyOf(seed: number): { ops: LedgerTransaction[]; model: Model } {
  const r = rng(seed)
  const model = new Model()
  for (let i = 0; i < 60; i++) {
    const tx = randomTx(r, `t${i}`)
    if (tx) model.commit(null, tx)
  }
  const ids = [...model.txs.keys()]
  for (let i = 0; i < 10 && ids.length > 0; i++) {
    const id = ids[Math.floor(r() * ids.length)]
    const prior = model.txs.get(id) ?? null
    if (r() < 0.5) {
      const next = randomTx(r, id)
      if (next) model.commit(prior, next)
    } else model.commit(prior, null)
  }
  return { ops: [...model.txs.values()], model }
}

function wholeMonths(r: () => number): DayRange {
  const first = monthOf(addDays(TODAY, -Math.floor(r() * 150)))
  const last = monthOf(addDays(TODAY, Math.floor(r() * 60)))
  return { from: `${first}-01`, to: monthBounds(last).last }
}

/** The balance at the close of `day`: the opening plus every movement up to that day (an oracle independent of the rollups). */
function balanceAt(ops: readonly LedgerTransaction[], accountId: string, opening: number, day: string): number {
  let b = opening
  for (const tx of ops) for (const e of datedEffects(tx)) if (e.accountId === accountId && e.day <= day) b += e.delta
  return b
}

function bookFor(needs: readonly RateNeed[]): Map<string, RateQuote> {
  return new Map(needs.map((n) => [rateKey(n.currency, n.date), { rate: 4 + (Number(n.date.replaceAll('-', '')) % 37) / 100, rateDate: n.date, tableNo: null, final: true }]))
}

describe('report properties', () => {
  it('the rollups and the operations give the same Cash Flow and P&L (random companies, whole months, no filters)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { ops, model } = companyOf(seed)
      const range = wholeMonths(rng(seed + 1000))
      for (const includeExcluded of [false, true]) {
        const cfInput = { ...range, accountIds: IDS, includeExcluded, categoryTypes: TYPES }
        const computed = operationRollups(ops, BASE, range, { parts: ['cash', 'cashcat'] })
        expect(computed.uncountable).toEqual([])
        expect(buildCashFlowCore(factsFromRollupDocs(selectRollupDocs(model.rollups, new Set(IDS), range, 'cashflow')), cfInput), `seed ${seed}`).toEqual(
          buildCashFlowCore(factsFromRollupDocs(computed.docs), cfInput),
        )
        const plInput = { ...range, includeExcluded, categoryTypes: TYPES }
        expect(buildPLCore(factsFromRollupDocs(selectRollupDocs(model.rollups, new Set(IDS), range, 'pl')), plInput), `seed ${seed}`).toEqual(
          buildPLCore(factsFromRollupDocs(operationRollups(ops, BASE, range, { parts: ['pl'] }).docs), plInput),
        )
      }
    }
  })

  it('opening + the lines = closing to the minor unit, for random companies, periods and filters', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { ops } = companyOf(seed)
      const r = rng(seed + 2000)
      const months = wholeMonths(r)
      const period: DayRange = { from: addDays(months.from, Math.floor(r() * 10)), to: months.to }
      const filters: AnalyticsFilters = {
        ...EMPTY_ANALYTICS_FILTERS,
        accountIds: r() < 0.4 ? [IDS[Math.floor(r() * IDS.length)]] : [],
        types: r() < 0.3 ? ['expense'] : [],
      }
      const accountIds = filters.accountIds.length > 0 ? filters.accountIds : IDS
      const inScope = filters.accountIds.length > 0 ? ops.filter((tx) => matchesSharedChoices(tx, { accountIds: filters.accountIds, counterpartyIds: [], tagIds: [] })) : ops
      const chosen = filterForAnalytics(ops, filters, TYPES)
      const scope = factsFromRollupDocs(operationRollups(inScope, BASE, period, { accounts: new Set(accountIds), parts: ['cash'] }).docs)
      const report = factsFromRollupDocs(operationRollups(chosen.operations, BASE, period, { accounts: new Set(accountIds), parts: ['cash'] }).docs)
      const days = reconciliationDays(period.from, period.to, TODAY)
      const accounts = ACCOUNTS.filter((a) => accountIds.includes(a.id)).map((a) => ({
        accountId: a.id,
        currency: a.currency,
        openingMinor: balanceAt(ops, a.id, a.openingMinor, days.openingDay),
        closingMinor: balanceAt(ops, a.id, a.openingMinor, days.closingDay),
      }))
      const rec = reconcile({ baseCurrency: BASE, days, accounts, scope, report, includeExcluded: chosen.includeExcluded, rates: bookFor(ratesForReconciliation(accounts, scope, days, BASE)) })
      expect(rec.valued, `seed ${seed}`).toBe(true)
      expect(rec.discrepancyBase, `seed ${seed}`).toBe(0)
      const sum = (rec.openingBase ?? NaN) + rec.reportNetBase + (rec.excludedBase ?? 0) + rec.outsideFilterBase + (rec.transfersBase ?? NaN) + (rec.fxBase ?? NaN)
      expect(sum, `seed ${seed}`).toBe(rec.closingBase)
    }
  })

  it('the order of the operations changes nothing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { ops } = companyOf(seed)
      const r = rng(seed + 3000)
      const shuffled = [...ops]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const range = wholeMonths(r)
      const build = (list: readonly LedgerTransaction[]) => {
        const facts = factsFromRollupDocs(operationRollups(list, BASE, range, { parts: ['cash', 'cashcat', 'pl'] }).docs)
        return [
          buildCashFlowCore(facts, { ...range, accountIds: IDS, includeExcluded: false, categoryTypes: TYPES }),
          buildPLCore(facts, { ...range, includeExcluded: false, categoryTypes: TYPES }),
        ]
      }
      expect(build(shuffled), `seed ${seed}`).toEqual(build(ops))
    }
  })
})
