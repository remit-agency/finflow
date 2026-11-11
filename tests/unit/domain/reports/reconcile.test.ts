import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { factsFromRollupDocs, operationRollups } from '@/lib/domain/reports/facts'
import { rateKey, ratesForReconciliation, reconcile, reconciliationDays, valuationDate, type ReconcileAccount } from '@/lib/domain/reports/reconcile'
import type { RateQuote, ReportFacts } from '@/lib/domain/reports/types'
import { op } from './fixtures'

const OCT = { from: '2026-10-01', to: '2026-10-31' }
const DAYS = reconciliationDays(OCT.from, OCT.to, '2026-10-27')
const quote = (rate: number, rateDate: string): RateQuote => ({ rate, rateDate, tableNo: `T/${rateDate}`, final: true })
const RATES = new Map([
  [rateKey('EUR', '2026-10-01'), quote(4, '2026-09-30')],
  [rateKey('EUR', '2026-10-20'), quote(4.4, '2026-10-19')],
  [rateKey('EUR', '2026-10-28'), quote(4.4, '2026-10-27')],
])

const OPS: LedgerTransaction[] = [
  op({ type: 'income', accountId: 'pln', amountMinor: 50_000, paymentDate: '2026-10-05', categoryId: 'k-in' }),
  op({ type: 'expense', accountId: 'pln', amountMinor: 12_000, paymentDate: '2026-10-06', categoryId: 'k-ex' }),
  op({ type: 'expense', accountId: 'pln', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true }),
  op({ type: 'income', accountId: 'eur', currency: 'EUR', amountMinor: 5_000, paymentDate: '2026-10-10', categoryId: 'k-in', base: { payment: 21_000, accrual: 21_000 } }),
  op({ type: 'transfer', accountId: 'pln', toAccountId: 'eur', amountMinor: 43_000, toAmountMinor: 10_000, toCurrency: 'EUR', paymentDate: '2026-10-20' }),
]
const PLN: ReconcileAccount = { accountId: 'pln', currency: 'PLN', openingMinor: 100_000, closingMinor: 72_000 }
const EUR: ReconcileAccount = { accountId: 'eur', currency: 'EUR', openingMinor: 10_000, closingMinor: 25_000 }

function factsOf(ops: readonly LedgerTransaction[], accounts: readonly string[]): ReportFacts {
  return factsFromRollupDocs(operationRollups(ops, 'PLN', OCT, { accounts: new Set(accounts), parts: ['cash'] }).docs)
}

describe('reconciliationDays', () => {
  it('the close of the day before the period and of its last day, never after today', () => {
    expect(DAYS).toEqual({ openingDay: '2026-09-30', closingDay: '2026-10-27' })
    expect(reconciliationDays('2026-01-01', '2026-03-31', '2026-10-27')).toEqual({ openingDay: '2025-12-31', closingDay: '2026-03-31' })
    expect(reconciliationDays('2026-11-01', '2026-11-30', '2026-10-27')).toEqual({ openingDay: '2026-10-27', closingDay: '2026-10-27' })
    expect(valuationDate('2026-10-27')).toBe('2026-10-28')
  })
})

describe('ratesForReconciliation', () => {
  it('the opening and closing valuation days and each transfer day of a foreign account; nothing for the company currency', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    // The valuations (opening, closing) first, then the transfer days: a bounded NBP request leaves the transfers unvalued first.
    expect(ratesForReconciliation([PLN, EUR], scope, DAYS, 'PLN')).toEqual([
      { currency: 'EUR', date: '2026-10-01' },
      { currency: 'EUR', date: '2026-10-28' },
      { currency: 'EUR', date: '2026-10-20' },
    ])
    expect(ratesForReconciliation([PLN], scope, DAYS, 'PLN')).toEqual([])
  })
})

describe('reconcile', () => {
  it('adds up across currencies: the EUR account has its exchange difference, the transfer is in PLN at the NBP rate of its day', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [PLN, EUR], scope, report: scope, includeExcluded: false, rates: RATES, unrequestedRates: [] })
    expect(r).toMatchObject({
      openingDay: '2026-09-30',
      closingDay: '2026-10-27',
      valued: true,
      missingRates: [],
      openingBase: 140_000,
      reportNetBase: 59_000,
      excludedBase: -23_000,
      excludedIncluded: false,
      outsideFilterBase: 0,
      transfersBase: 1_000,
      fxBase: 5_000,
      closingBase: 182_000,
      discrepancyBase: 0,
    })
    expect(r.accounts).toEqual([
      { accountId: 'pln', currency: 'PLN', openingMinor: 100_000, closingMinor: 72_000, movementMinor: -28_000, openingBase: 100_000, closingBase: 72_000, transfersBase: -43_000, fxBase: 0 },
      { accountId: 'eur', currency: 'EUR', openingMinor: 10_000, closingMinor: 25_000, movementMinor: 15_000, openingBase: 40_000, closingBase: 110_000, transfersBase: 44_000, fxBase: 5_000 },
    ])
    expect(r.rates).toEqual([{ currency: 'EUR', opening: quote(4, '2026-09-30'), closing: quote(4.4, '2026-10-27') }])
  })

  it('a concrete tag: the excluded operations are in the report, the rest of the accounts is outside the filter', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    const report = factsOf(OPS.filter((tx) => tx.tags.includes('vat')), ['pln', 'eur'])
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [PLN, EUR], scope, report, includeExcluded: true, rates: RATES, unrequestedRates: [] })
    expect(r).toMatchObject({ reportNetBase: -23_000, excludedBase: null, excludedIncluded: true, outsideFilterBase: 59_000, discrepancyBase: 0 })
  })

  it('one account: its transfers with the other accounts are a line of their own', () => {
    const scope = factsOf(OPS.filter((tx) => tx.accountId === 'eur' || tx.toAccountId === 'eur'), ['eur'])
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [EUR], scope, report: scope, includeExcluded: false, rates: RATES, unrequestedRates: [] })
    expect(r).toMatchObject({ openingBase: 40_000, reportNetBase: 21_000, excludedBase: 0, outsideFilterBase: 0, transfersBase: 44_000, fxBase: 5_000, closingBase: 110_000, discrepancyBase: 0 })
  })

  it('a balance that does not agree with the movement is «Розбіжність», not an exchange difference', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    const off = (accounts: ReconcileAccount[]) => reconcile({ baseCurrency: 'PLN', days: DAYS, accounts, scope, report: scope, includeExcluded: false, rates: RATES, unrequestedRates: [] })
    const pln = off([{ ...PLN, closingMinor: 72_100 }, EUR])
    expect([pln.discrepancyBase, pln.fxBase]).toEqual([100, 5_000])
    // 10 cents of EUR too many: 250.10 € at 4.40 is 1100.44 zł against the 1100.00 the movement explains.
    const eur = off([PLN, { ...EUR, closingMinor: 25_010 }])
    expect([eur.discrepancyBase, eur.fxBase]).toEqual([44, 5_000])
  })

  it('a missing rate: not valued, the currency and day named, the lines that need it null, the report lines stay', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    const rates = new Map(RATES)
    rates.delete(rateKey('EUR', '2026-10-20'))
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [PLN, EUR], scope, report: scope, includeExcluded: false, rates, unrequestedRates: [] })
    expect(r).toMatchObject({
      valued: false,
      missingRates: [{ currency: 'EUR', date: '2026-10-20' }],
      openingBase: 140_000,
      reportNetBase: 59_000,
      excludedBase: -23_000,
      transfersBase: null,
      fxBase: null,
      closingBase: 182_000,
      discrepancyBase: null,
    })
  })

  it('a company in PLN only needs no rate and is exactly the equation of the spec', () => {
    const ops = OPS.filter((tx) => tx.currency === 'PLN' && tx.type !== 'transfer')
    const scope = factsOf(ops, ['pln'])
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [{ ...PLN, closingMinor: 115_000 }], scope, report: scope, includeExcluded: false, rates: new Map(), unrequestedRates: [] })
    expect(r).toMatchObject({ valued: true, openingBase: 100_000, reportNetBase: 38_000, excludedBase: -23_000, transfersBase: 0, fxBase: 0, closingBase: 115_000, discrepancyBase: 0, rates: [] })
  })

  it('rates the caller did not ask NBP for are missing like any other, and counted apart: the figures of the report stay', () => {
    const scope = factsOf(OPS, ['pln', 'eur'])
    const rates = new Map(RATES)
    rates.delete(rateKey('EUR', '2026-10-20'))
    const notAsked = { currency: 'EUR', date: '2026-10-20' }
    const r = reconcile({ baseCurrency: 'PLN', days: DAYS, accounts: [PLN, EUR], scope, report: scope, includeExcluded: false, rates, unrequestedRates: [notAsked] })
    expect(r).toMatchObject({ valued: false, reportNetBase: 59_000, discrepancyBase: null })
    expect(r.missingRates).toEqual([notAsked])
    expect(r.unrequestedRates).toEqual([notAsked])
  })
})
