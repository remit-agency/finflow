// lib/domain/reports/balances.ts
// The balances at the close of a day (the dashboard «Гроші зараз» and the Balance page, S12): every account in its own
// currency and in the company currency at the last NBP table of that day; a currency without a rate is left out of the
// total and the answer says it is not complete.
import { mulRate } from '@/lib/domain/ledger/money'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { rateKey, valuationDate, type RateBook } from './reconcile'
import type { BalanceLine, BalancesReport, CurrencyTotal, RateNeed } from './types'

/** One rate per foreign currency of the accounts, for the close of `day`. */
export function balanceRates(accounts: ReadonlyArray<Pick<LedgerAccount, 'currency'>>, day: string, baseCurrency: string): RateNeed[] {
  return [...new Set(accounts.map((a) => a.currency).filter((c) => c !== baseCurrency))].sort().map((currency) => ({ currency, date: valuationDate(day) }))
}

export interface BalancesInput {
  date: string
  baseCurrency: string
  accounts: readonly LedgerAccount[]
  /** The balance of each account at the close of `date` (`balancesAt`); an account missing here keeps `balanceMinor`. */
  balances: ReadonlyMap<string, number>
  rates: RateBook
}

export function balancesReport(input: BalancesInput): BalancesReport {
  const { date, baseCurrency, rates } = input
  const quote = (currency: string) => rates.get(rateKey(currency, valuationDate(date))) ?? null
  const accounts: BalanceLine[] = input.accounts.map((a) => {
    const balanceMinor = input.balances.get(a.id) ?? a.balanceMinor
    const rate = a.currency === baseCurrency ? null : quote(a.currency)
    const baseMinor = a.currency === baseCurrency ? balanceMinor : rate === null ? null : mulRate(balanceMinor, rate.rate)
    return { accountId: a.id, name: a.name, type: a.type, currency: a.currency, color: a.color, balanceMinor, baseMinor }
  })
  // The company currency first, then the others alphabetically.
  const currencies = [...new Set(accounts.map((a) => a.currency))].sort((x, y) => (x === baseCurrency ? -1 : y === baseCurrency ? 1 : x < y ? -1 : x > y ? 1 : 0))
  const byCurrency: CurrencyTotal[] = currencies.map((currency) => {
    const lines = accounts.filter((l) => l.currency === currency)
    return {
      currency,
      balanceMinor: lines.reduce((s, l) => s + l.balanceMinor, 0),
      baseMinor: lines.some((l) => l.baseMinor === null) ? null : lines.reduce((s, l) => s + (l.baseMinor ?? 0), 0),
      rate: currency === baseCurrency ? null : quote(currency),
    }
  })
  return {
    date,
    currency: baseCurrency,
    accounts,
    totalBase: accounts.reduce((s, l) => s + (l.baseMinor ?? 0), 0),
    complete: accounts.every((l) => l.baseMinor !== null),
    byCurrency,
  }
}
