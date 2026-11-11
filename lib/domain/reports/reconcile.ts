// lib/domain/reports/reconcile.ts
// The month-end reconciliation (S12): opening + net movement of the report + excluded from analytics + outside the filter
// + transfers + exchange difference = closing, in the company currency, for the chosen accounts and period. What is left
// is «Розбіжність», never rounded away: the balances come from the accounts (balance at a day), the movement from the
// report path, so a drift between the two shows. A balance at the close of day D is valued at the last NBP table published
// on D or before (`valuationDate`: resolveRate's rule is «strictly before», so it is asked for D + 1); a movement keeps the
// rate of its own day (income and expense their stored base, a transfer the S04 rate of its day).
import { addDays } from '@/lib/domain/ledger/days'
import { mulRate } from '@/lib/domain/ledger/money'
import type { AccountReconciliation, CashCell, CurrencyRates, DayCells, RateNeed, RateQuote, Reconciliation, ReportFacts } from './types'

/** The close of the day before the period and of its last day, neither after today (no actual operation is later). */
export function reconciliationDays(from: string, to: string, today: string): { openingDay: string; closingDay: string } {
  const before = addDays(from, -1)
  return { openingDay: before < today ? before : today, closingDay: to < today ? to : today }
}

export function rateKey(currency: string, date: string): string {
  return `${currency}@${date}`
}

/** The day to ask `resolveRate` for when a balance at the close of `day` is valued. */
export function valuationDate(day: string): string {
  return addDays(day, 1)
}

/** The rates a reconciliation was given, by `rateKey`; a missing key is a rate NBP could not give. */
export type RateBook = ReadonlyMap<string, RateQuote>

export interface ReconcileAccount {
  accountId: string
  currency: string
  openingMinor: number
  closingMinor: number
}

function cellsOf(facts: ReportFacts, accountId: string): Array<[string, CashCell]> {
  return [...(facts.cash.get(accountId) ?? []), ...(facts.excludedCash.get(accountId) ?? [])]
}

function byNeed(a: RateNeed, b: RateNeed): number {
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/**
 * Each rate the reconciliation needs: the opening and closing valuation of every foreign account, then each day it transferred
 * (each group in date order). The valuations come first: when a report needs more NBP month tables than it asks, the transfers
 * are the rates left unvalued, not the balances the equation is made of.
 */
export function ratesForReconciliation(
  accounts: readonly ReconcileAccount[],
  scope: ReportFacts,
  days: { openingDay: string; closingDay: string },
  baseCurrency: string,
): RateNeed[] {
  const valuations = new Map<string, RateNeed>()
  const transfers = new Map<string, RateNeed>()
  for (const a of accounts) {
    if (a.currency === baseCurrency) continue
    for (const date of [valuationDate(days.openingDay), valuationDate(days.closingDay)]) valuations.set(rateKey(a.currency, date), { currency: a.currency, date })
    for (const [day, c] of cellsOf(scope, a.accountId)) {
      if (c.transferInMinor !== 0 || c.transferOutMinor !== 0) transfers.set(rateKey(a.currency, day), { currency: a.currency, date: day })
    }
  }
  const inOrder = (m: Map<string, RateNeed>): RateNeed[] => [...m.values()].sort(byNeed)
  const transferOnly = inOrder(transfers).filter((n) => !valuations.has(rateKey(n.currency, n.date)))
  return [...inOrder(valuations), ...transferOnly]
}

function netBase(byAccount: Map<string, DayCells>, accounts: ReadonlySet<string>): number {
  let sum = 0
  for (const [accountId, cells] of byAccount) {
    if (!accounts.has(accountId)) continue
    for (const c of cells.values()) sum += c.inBase - c.outBase
  }
  return sum
}

/** The rates the reconciliation is missing that NBP was asked for and did not give (the missing ones but the unrequested). */
export function ratesNbpDidNotGive(r: Pick<Reconciliation, 'missingRates' | 'unrequestedRates'>): RateNeed[] {
  const notAsked = new Set(r.unrequestedRates.map((n) => rateKey(n.currency, n.date)))
  return r.missingRates.filter((n) => !notAsked.has(rateKey(n.currency, n.date)))
}

export interface ReconcileInput {
  baseCurrency: string
  days: { openingDay: string; closingDay: string }
  /** The chosen accounts with their balances at the close of the two days. */
  accounts: readonly ReconcileAccount[]
  /** Every operation of the chosen accounts in the period (the account filter only). */
  scope: ReportFacts
  /** The operations the report chose (every filter). */
  report: ReportFacts
  includeExcluded: boolean
  rates: RateBook
  /** Rates the caller did not ask NBP for (past its month bound): missing like the others, and named apart from them. */
  unrequestedRates: readonly RateNeed[]
}

export function reconcile(input: ReconcileInput): Reconciliation {
  const { baseCurrency, days, scope, report, rates, includeExcluded, unrequestedRates } = input
  const ids = new Set(input.accounts.map((a) => a.accountId))
  const missing = new Map<string, RateNeed>()
  const value = (minor: number, currency: string, date: string): number | null => {
    if (currency === baseCurrency) return minor
    const quote = rates.get(rateKey(currency, date))
    if (quote === undefined) {
      missing.set(rateKey(currency, date), { currency, date })
      return null
    }
    return mulRate(minor, quote.rate)
  }

  const reportAnalytics = netBase(report.cash, ids)
  const reportExcluded = netBase(report.excludedCash, ids)
  const reportNetBase = reportAnalytics + (includeExcluded ? reportExcluded : 0)
  const outsideFilterBase = netBase(scope.cash, ids) + netBase(scope.excludedCash, ids) - reportAnalytics - reportExcluded

  const openingDate = valuationDate(days.openingDay)
  const closingDate = valuationDate(days.closingDay)
  const accounts: AccountReconciliation[] = input.accounts.map((a) => {
    let movementMinor = 0
    let incomeExpenseBase = 0
    let transfersBase: number | null = 0
    for (const [day, c] of cellsOf(scope, a.accountId)) {
      movementMinor += c.inMinor - c.outMinor + c.transferInMinor - c.transferOutMinor
      incomeExpenseBase += c.inBase - c.outBase
      if (c.transferInMinor === 0 && c.transferOutMinor === 0) continue
      const moneyIn = value(c.transferInMinor, a.currency, day)
      const moneyOut = value(c.transferOutMinor, a.currency, day)
      transfersBase = transfersBase === null || moneyIn === null || moneyOut === null ? null : transfersBase + moneyIn - moneyOut
    }
    const openingBase = value(a.openingMinor, a.currency, openingDate)
    const closingBase = value(a.closingMinor, a.currency, closingDate)
    // The exchange difference is what the period's movement leaves at the closing rate: a balance that does not agree with
    // the movement is not an exchange difference, it stays in «Розбіжність».
    const expectedClosing = value(a.openingMinor + movementMinor, a.currency, closingDate)
    const fxBase =
      a.currency === baseCurrency
        ? 0
        : openingBase === null || expectedClosing === null || transfersBase === null
          ? null
          : expectedClosing - openingBase - incomeExpenseBase - transfersBase
    return { accountId: a.accountId, currency: a.currency, openingMinor: a.openingMinor, closingMinor: a.closingMinor, movementMinor, openingBase, closingBase, transfersBase, fxBase }
  })

  const total = (pick: (a: AccountReconciliation) => number | null): number | null =>
    accounts.reduce<number | null>((sum, a) => {
      const v = pick(a)
      return sum === null || v === null ? null : sum + v
    }, 0)
  const openingBase = total((a) => a.openingBase)
  const closingBase = total((a) => a.closingBase)
  const transfersBase = total((a) => a.transfersBase)
  const fxBase = total((a) => a.fxBase)
  const excludedBase = includeExcluded ? null : reportExcluded
  const discrepancyBase =
    openingBase === null || closingBase === null || transfersBase === null || fxBase === null
      ? null
      : closingBase - openingBase - reportNetBase - (excludedBase ?? 0) - outsideFilterBase - transfersBase - fxBase
  const currencies = [...new Set(input.accounts.map((a) => a.currency).filter((c) => c !== baseCurrency))].sort()
  const rateLines: CurrencyRates[] = currencies.map((currency) => ({
    currency,
    opening: rates.get(rateKey(currency, openingDate)) ?? null,
    closing: rates.get(rateKey(currency, closingDate)) ?? null,
  }))
  return {
    openingDay: days.openingDay,
    closingDay: days.closingDay,
    valued: missing.size === 0,
    missingRates: [...missing.values()].sort(byNeed),
    unrequestedRates: [...unrequestedRates].sort(byNeed),
    openingBase,
    reportNetBase,
    excludedBase,
    excludedIncluded: includeExcluded,
    outsideFilterBase,
    transfersBase,
    fxBase,
    closingBase,
    discrepancyBase,
    accounts,
    rates: rateLines,
  }
}
