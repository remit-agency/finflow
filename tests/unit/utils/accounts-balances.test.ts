// The sidebar total (summarizeAccounts, the client) must equal the Balance total (balancesReport, the server, S12) for the same
// accounts and the same NBP rates: both convert each account with mulRate in minor units.
import { describe, expect, it } from 'vitest'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { balancesReport } from '@/lib/domain/reports/balances'
import { rateKey, valuationDate, type RateBook } from '@/lib/domain/reports/reconcile'
import { summarizeAccounts } from '@/lib/utils/accounts'

const DAY = '2026-11-16'
const COMPANY = 'UAH'
// Odd rates on purpose: the rounding of each account decides the last cent.
const RATES = { PLN: 11.36437, EUR: 46.13571 } as const

const ledger = (id: string, currency: string, balanceMinor: number): LedgerAccount => ({
  id,
  name: id,
  type: 'bank',
  currency,
  color: '#6366f1',
  openingMinor: 0,
  balanceMinor,
})

/** The NBP quotes the server would give for the close of DAY (`valuationDate(DAY)`), keyed as `balancesReport` reads them. */
function rateBook(quotes: Partial<Record<string, number>>): RateBook {
  return new Map(
    Object.entries(quotes).map(([currency, rate]) => [rateKey(currency, valuationDate(DAY)), { rate: rate as number, rateDate: DAY, tableNo: null, final: true }]),
  )
}

/** The accounts as the sidebar holds them: the major-unit balance and the currency. */
const asSidebar = (accounts: readonly LedgerAccount[]) => accounts.map((a) => ({ balance: fromMinor(a.balanceMinor), currency: a.currency }))

const accounts = [
  ledger('monobank', 'UAH', 231660), // 2 316,60
  ledger('kasa', 'UAH', -6000), // -60,00
  ledger('millennium', 'PLN', -1553526), // -15 535,26 (negative foreign)
  ledger('cash-eur', 'EUR', 123457), // 1 234,57 (odd amount)
]

describe('sidebar total against the Balance report', () => {
  it('equals the Balance total for the same accounts and rates', () => {
    const report = balancesReport({ date: DAY, baseCurrency: COMPANY, accounts, balances: new Map(), rates: rateBook(RATES) })
    expect(report.complete).toBe(true)

    const sidebar = summarizeAccounts(asSidebar(accounts), COMPANY, new Map(Object.entries(RATES)))
    expect(sidebar.total).toBe(fromMinor(report.totalBase))
    // 2 316,60 - 60,00 - 176 548,44 (PLN) + 56 957,76 (EUR)
    expect(sidebar.total).toBe(-117334.08)
    expect(sidebar).toMatchObject({ count: 4, approximate: true, unvalued: 0 })
  })

  it('leaves out the same account and counts it as unvalued when a currency has no rate', () => {
    const report = balancesReport({ date: DAY, baseCurrency: COMPANY, accounts, balances: new Map(), rates: rateBook({ PLN: RATES.PLN }) })
    const missing = report.accounts.filter((l) => l.baseMinor === null).length
    expect(missing).toBe(1)
    expect(report.complete).toBe(false)

    const sidebar = summarizeAccounts(asSidebar(accounts), COMPANY, new Map([['PLN', RATES.PLN]]))
    expect(sidebar.unvalued).toBe(missing)
    expect(sidebar.total).toBe(fromMinor(report.totalBase))
    // 2 256,60 - 176 548,44 (PLN); the EUR account is not counted.
    expect(sidebar.total).toBe(-174291.84)
  })
})
