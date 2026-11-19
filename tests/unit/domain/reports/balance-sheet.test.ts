import { describe, expect, it } from 'vitest'
import { balanceSheetTotals, type BalanceSheetFields } from '@/lib/domain/reports/balance-sheet'

const NO_FIELDS: BalanceSheetFields = {
  realestate: 0, equipment: 0, inventory: 0, receivables: 0, charter_capital: 0, additional_capital: 0, loans: 0,
}

const bank = (base: number | null) => ({ type: 'bank', base })
const cash = (base: number | null) => ({ type: 'cash', base })
const crypto = (base: number | null) => ({ type: 'crypto', base })

describe('balanceSheetTotals', () => {
  it('without crypto the numbers are the money accounts, counted once', () => {
    const t = balanceSheetTotals([bank(1000), cash(250.5)], NO_FIELDS)
    expect(t.cryptoTotal).toBe(0)
    expect(t.fixedTotal).toBe(0)
    expect(t.moneyTotal).toBe(1250.5)
    expect(t.totalAssets).toBe(1250.5)
    expect(t.retainedEarnings).toBe(1250.5)
    expect(t.totalLiabilities).toBe(1250.5)
    expect(t.difference).toBe(0)
  })

  it('a crypto account only: it is in fixed assets and in the total once, not in money', () => {
    const t = balanceSheetTotals([crypto(500)], NO_FIELDS)
    expect(t.cryptoTotal).toBe(500)
    expect(t.fixedTotal).toBe(500)
    expect(t.moneyTotal).toBe(0)
    expect(t.totalAssets).toBe(500)
    expect(t.retainedEarnings).toBe(500)
    expect(t.difference).toBe(0)
  })

  it('bank, cash and crypto: money is the non-crypto sum, retained earnings the sum of all accounts', () => {
    const t = balanceSheetTotals([bank(1000), cash(200), crypto(500)], NO_FIELDS)
    expect(t.cryptoTotal).toBe(500)
    expect(t.fixedTotal).toBe(500)
    expect(t.moneyTotal).toBe(1200)
    expect(t.totalAssets).toBe(1700)
    expect(t.retainedEarnings).toBe(1700)
    expect(t.totalLiabilities).toBe(1700)
    expect(t.difference).toBe(0)
  })

  it('an unvalued line (base null) counts as 0, for money and for crypto', () => {
    const t = balanceSheetTotals([bank(1000), bank(null), crypto(null)], NO_FIELDS)
    expect(t.cryptoTotal).toBe(0)
    expect(t.moneyTotal).toBe(1000)
    expect(t.totalAssets).toBe(1000)
    expect(t.difference).toBe(0)
  })

  it('manual fields add to their sections and to the totals', () => {
    const fields: BalanceSheetFields = {
      realestate: 100, equipment: 50, inventory: 20, receivables: 30, charter_capital: 300, additional_capital: 100, loans: 200,
    }
    const t = balanceSheetTotals([bank(1000), crypto(500)], fields)
    expect(t.fixedTotal).toBe(650)
    expect(t.currentTotal).toBe(50)
    expect(t.moneyTotal).toBe(1000)
    expect(t.totalAssets).toBe(1700)
    expect(t.retainedEarnings).toBe(1500)
    expect(t.equityTotal).toBe(1900)
    expect(t.debtTotal).toBe(200)
    expect(t.totalLiabilities).toBe(2100)
    expect(t.difference).toBe(-400)
  })

  it('the difference is 0 when the manual assets equal the manual liabilities and equity', () => {
    // Manual assets 100 (real estate) = manual equity 100 (charter capital). Accounts: bank 1000 + crypto 500.
    // Assets: fixed 100 + crypto 500 + money 1000 = 1600. Liabilities: charter 100 + retained 1500 (all accounts) = 1600.
    const t = balanceSheetTotals([bank(1000), crypto(500)], { ...NO_FIELDS, realestate: 100, charter_capital: 100 })
    expect(t.totalAssets).toBe(1600)
    expect(t.totalLiabilities).toBe(1600)
    expect(t.difference).toBe(0)
  })
})
