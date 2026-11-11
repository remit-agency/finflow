import { describe, expect, it } from 'vitest'
import type { LedgerAccount } from '@/lib/domain/ledger/types'
import { balanceRates, balancesReport } from '@/lib/domain/reports/balances'
import { rateKey } from '@/lib/domain/reports/reconcile'
import type { RateQuote } from '@/lib/domain/reports/types'

const account = (id: string, currency: string, balanceMinor: number): LedgerAccount => ({
  id, name: id.toUpperCase(), type: 'bank', currency, color: '#00c896', openingMinor: 0, balanceMinor,
})
const ACCOUNTS = [account('pln', 'PLN', 72_000), account('eur', 'EUR', 25_000), account('eur2', 'EUR', 1_001), account('usd', 'USD', 10_000)]
const EUR: RateQuote = { rate: 4.4, rateDate: '2026-10-27', tableNo: '209/A/NBP/2026', final: false }
const USD: RateQuote = { rate: 4, rateDate: '2026-10-27', tableNo: '209/A/NBP/2026', final: false }

describe('balancesReport', () => {
  it('values each account at the NBP rate of the day; the totals per currency add up to the total', () => {
    const rates = new Map([[rateKey('EUR', '2026-10-28'), EUR], [rateKey('USD', '2026-10-28'), USD]])
    const report = balancesReport({ date: '2026-10-27', baseCurrency: 'PLN', accounts: ACCOUNTS, balances: new Map(), rates })
    expect(report.accounts.map((a) => [a.accountId, a.balanceMinor, a.baseMinor])).toEqual([
      ['pln', 72_000, 72_000],
      ['eur', 25_000, 110_000],
      ['eur2', 1_001, 4_404],
      ['usd', 10_000, 40_000],
    ])
    expect(report.byCurrency).toEqual([
      { currency: 'PLN', balanceMinor: 72_000, baseMinor: 72_000, rate: null },
      { currency: 'EUR', balanceMinor: 26_001, baseMinor: 114_404, rate: EUR },
      { currency: 'USD', balanceMinor: 10_000, baseMinor: 40_000, rate: USD },
    ])
    expect(report).toMatchObject({ date: '2026-10-27', currency: 'PLN', totalBase: 226_404, complete: true })
  })

  it('a missing rate leaves the account out of the total and says so', () => {
    const report = balancesReport({ date: '2026-10-27', baseCurrency: 'PLN', accounts: ACCOUNTS, balances: new Map(), rates: new Map([[rateKey('EUR', '2026-10-28'), EUR]]) })
    expect(report.accounts.find((a) => a.accountId === 'usd')?.baseMinor).toBeNull()
    expect(report.byCurrency.find((c) => c.currency === 'USD')).toEqual({ currency: 'USD', balanceMinor: 10_000, baseMinor: null, rate: null })
    expect(report).toMatchObject({ totalBase: 186_404, complete: false })
  })

  it('the balance of the day comes from `balances`; an account without one keeps its own balance', () => {
    const report = balancesReport({ date: '2026-10-15', baseCurrency: 'PLN', accounts: [ACCOUNTS[0]], balances: new Map([['pln', 115_000]]), rates: new Map() })
    expect(report.accounts[0].balanceMinor).toBe(115_000)
    expect(balancesReport({ date: '2026-10-15', baseCurrency: 'PLN', accounts: [ACCOUNTS[0]], balances: new Map(), rates: new Map() }).accounts[0].balanceMinor).toBe(72_000)
  })
})

describe('balanceRates', () => {
  it('one rate per foreign currency, asked for the day after (the last table of the day or before)', () => {
    expect(balanceRates(ACCOUNTS, '2026-10-27', 'PLN')).toEqual([
      { currency: 'EUR', date: '2026-10-28' },
      { currency: 'USD', date: '2026-10-28' },
    ])
  })
})
