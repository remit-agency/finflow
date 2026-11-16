import { describe, expect, it } from 'vitest'
import { effectiveSelection, foreignCurrencies, summarizeAccounts } from '@/lib/utils/accounts'

const account = (balance: number, currency: string) => ({ balance, currency })

describe('summarizeAccounts', () => {
  it('gives a zero total for no accounts', () => {
    expect(summarizeAccounts([], 'PLN')).toEqual({ currency: 'PLN', total: 0, count: 0, approximate: false, unvalued: 0 })
  })

  it('sums a single account in the company currency', () => {
    expect(summarizeAccounts([account(1500.5, 'PLN')], 'PLN')).toEqual({ currency: 'PLN', total: 1500.5, count: 1, approximate: false, unvalued: 0 })
  })

  it('sums only the company-currency accounts when there are no foreign accounts', () => {
    const accounts = [account(1000, 'PLN'), account(50.25, 'PLN')]
    expect(summarizeAccounts(accounts, 'PLN')).toEqual({ currency: 'PLN', total: 1050.25, count: 2, approximate: false, unvalued: 0 })
  })

  it('gives zero when no account is in the company currency and no rate is given', () => {
    expect(summarizeAccounts([account(10, 'EUR')], 'PLN')).toEqual({ currency: 'PLN', total: 0, count: 0, approximate: true, unvalued: 1 })
  })

  it('includes negative balances', () => {
    expect(summarizeAccounts([account(300, 'UAH'), account(-450.5, 'UAH')], 'UAH')).toEqual({
      currency: 'UAH',
      total: -150.5,
      count: 2,
      approximate: false,
      unvalued: 0,
    })
  })

  it('rounds the floating-point sum to cents and never returns -0', () => {
    expect(summarizeAccounts([account(0.1, 'PLN'), account(0.2, 'PLN')], 'PLN').total).toBe(0.3)
    expect(Object.is(summarizeAccounts([account(-0.004, 'PLN')], 'PLN').total, 0)).toBe(true)
  })

  it('compares currency codes exactly', () => {
    expect(summarizeAccounts([account(5, 'pln')], 'PLN')).toEqual({ currency: 'PLN', total: 0, count: 0, approximate: true, unvalued: 1 })
  })

  it('converts a foreign account at its rate: 200 EUR at 4.30 is 860 on top of 1000 PLN', () => {
    const rates = new Map([['EUR', 4.3]])
    expect(summarizeAccounts([account(1000, 'PLN'), account(200, 'EUR')], 'PLN', rates)).toEqual({
      currency: 'PLN',
      total: 1860,
      count: 2,
      approximate: true,
      unvalued: 0,
    })
  })

  it('leaves out a currency without a rate and counts its accounts as unvalued', () => {
    const rates = new Map([['EUR', 4.3]])
    const accounts = [account(1000, 'PLN'), account(200, 'EUR'), account(5, 'GBP'), account(7, 'GBP')]
    expect(summarizeAccounts(accounts, 'PLN', rates)).toEqual({ currency: 'PLN', total: 1860, count: 2, approximate: true, unvalued: 2 })
  })

  it('converts a negative foreign balance with the balance report rounding (half away from zero)', () => {
    // -15 535,26 PLN at 11.36437 is -17 654 844 minor units: the Balance report's mulRate, per account.
    const rates = new Map([['PLN', 11.36437]])
    expect(summarizeAccounts([account(-15535.26, 'PLN')], 'UAH', rates).total).toBe(-176548.44)
  })

  it('is approximate whenever a foreign account exists, even one that is left out', () => {
    expect(summarizeAccounts([account(10, 'PLN')], 'PLN', new Map([['EUR', 4.3]])).approximate).toBe(false)
    expect(summarizeAccounts([account(10, 'PLN'), account(1, 'EUR')], 'PLN', new Map([['EUR', 4.3]])).approximate).toBe(true)
    expect(summarizeAccounts([account(10, 'PLN'), account(1, 'EUR')], 'PLN', new Map()).approximate).toBe(true)
  })

  it('never returns -0 after a conversion that nets to zero', () => {
    const total = summarizeAccounts([account(-0.01, 'EUR')], 'PLN', new Map([['EUR', 0.4]])).total
    expect(Object.is(total, 0)).toBe(true)
  })
})

describe('foreignCurrencies', () => {
  it('lists the distinct other currencies, sorted, without the company currency', () => {
    const accounts = [account(1, 'USD'), account(1, 'PLN'), account(1, 'EUR'), account(1, 'USD')]
    expect(foreignCurrencies(accounts, 'PLN')).toEqual(['EUR', 'USD'])
  })

  it('is empty when every account is in the company currency', () => {
    expect(foreignCurrencies([account(1, 'UAH'), account(2, 'UAH')], 'UAH')).toEqual([])
  })
})

describe('effectiveSelection', () => {
  const accounts = [{ id: 'a1' }, { id: 'a2' }]

  it('keeps a selection that is among the loaded accounts', () => {
    expect(effectiveSelection('a2', accounts)).toBe('a2')
  })

  it('drops a selection whose account is gone (deleted elsewhere)', () => {
    expect(effectiveSelection('gone', accounts)).toBeNull()
    expect(effectiveSelection('a1', [])).toBeNull()
  })

  it('keeps "all accounts" as null', () => {
    expect(effectiveSelection(null, accounts)).toBeNull()
  })
})
