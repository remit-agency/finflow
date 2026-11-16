import { fromMinor, mulRate, toMinor } from '@/lib/domain/ledger/money'
import type { Account } from '@/types'

// How an account type reads in lists (the journal's second line under the account name) is
// `t('common.accountTypes.<type>')`.

export interface AccountsSummary {
  /** The company currency the total is expressed in. */
  currency: string
  /** The sum of the accounts in `currency` and of the other currencies converted at their rate, rounded to cents. */
  total: number
  /** How many accounts the total includes (the company-currency ones and the converted foreign ones). */
  count: number
  /** True when another currency is among the accounts: the total then depends on NBP rates and is marked «≈». */
  approximate: boolean
  /** The foreign accounts left out because their currency has no rate. */
  unvalued: number
}

/** The other currencies of the accounts, distinct and sorted: the ones that need a rate. */
export function foreignCurrencies(accounts: ReadonlyArray<Pick<Account, 'currency'>>, companyCurrency: string): string[] {
  return [...new Set(accounts.map((a) => a.currency).filter((c) => c !== companyCurrency))].sort()
}

/**
 * Sidebar total («Разом у {currency}»). An account in the company currency is added as it is; an account in another
 * currency is converted with its NBP rate (`rates`: currency -> rate into the company currency) exactly as the Balance
 * report converts it (`mulRate` on its minor units, per account). A currency without a rate is left out and counted
 * in `unvalued`. Pure: the rates are read by the caller (`useSidebarRates`).
 */
export function summarizeAccounts(
  accounts: ReadonlyArray<Pick<Account, 'balance' | 'currency'>>,
  companyCurrency: string,
  rates: ReadonlyMap<string, number> = new Map(),
): AccountsSummary {
  let totalMinor = 0
  let count = 0
  let approximate = false
  let unvalued = 0
  for (const account of accounts) {
    const minor = toMinor(account.balance)
    if (account.currency === companyCurrency) {
      totalMinor += minor
      count += 1
      continue
    }
    approximate = true
    const rate = rates.get(account.currency)
    if (rate === undefined) {
      unvalued += 1
      continue
    }
    totalMinor += mulRate(minor, rate)
    count += 1
  }
  // Integer minor units: the sum is exact. -0 is normalised so the UI never renders "-0,00".
  const total = totalMinor === 0 ? 0 : fromMinor(totalMinor)
  return { currency: companyCurrency, total, count, approximate, unvalued }
}

/**
 * The account selection the journal may filter on: null ("all accounts") when the selected
 * account is not among the loaded ones, e.g. it was deleted in another tab.
 */
export function effectiveSelection(
  selectedId: string | null,
  accounts: ReadonlyArray<Pick<Account, 'id'>>,
): string | null {
  return selectedId !== null && accounts.some((a) => a.id === selectedId) ? selectedId : null
}
