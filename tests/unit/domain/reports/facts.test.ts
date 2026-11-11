import { describe, expect, it } from 'vitest'
import { contributions, type RollupFlat } from '@/lib/domain/ledger/rollups'
import { accrualShare, factsFromRollupDocs, mulDivRound, operationRollups, parseRollupId, reachesPeriod, selectRollupDocs } from '@/lib/domain/reports/facts'
import { op } from './fixtures'

const OCT = { from: '2026-10-01', to: '2026-10-31' }

describe('parseRollupId', () => {
  it('reads the daily, monthly and P&L ids and their x_ twins; anything else is null', () => {
    expect(parseRollupId('cash_acc1_2026-10-05')).toEqual({ kind: 'cash', excluded: false, accountId: 'acc1', day: '2026-10-05' })
    expect(parseRollupId('x_cash_acc_1_2026-10-05')).toEqual({ kind: 'cash', excluded: true, accountId: 'acc_1', day: '2026-10-05' })
    expect(parseRollupId('cashcat_2026-10')).toEqual({ kind: 'cashcat', excluded: false, month: '2026-10' })
    expect(parseRollupId('x_pl_2026-10')).toEqual({ kind: 'pl', excluded: true, month: '2026-10' })
    for (const id of ['cash_2026-10-05', 'cash__2026-10-05', 'cash_acc1_2026-13-05', 'pl_2026-13', 'cashcat_2026', 'meta']) {
      expect(parseRollupId(id), id).toBeNull()
    }
  })
})

describe('mulDivRound', () => {
  it('a share of an amount in whole minor units, half away from zero', () => {
    expect(mulDivRound(10, 1, 4)).toBe(3)
    expect(mulDivRound(-10, 1, 4)).toBe(-3)
    expect(mulDivRound(7, 1, 3)).toBe(2)
    expect(mulDivRound(31_000, 11, 31)).toBe(11_000)
    expect(mulDivRound(0, 1, 3)).toBe(0)
  })
})

describe('accrualShare', () => {
  it('the days of the month inside the accrual and the period, over the days of the month inside the accrual', () => {
    const lease = { mode: 'period', from: '2026-09-15', to: '2026-11-14' } as const
    expect(accrualShare(lease, '2026-10', OCT)).toEqual({ inside: 31, whole: 31 })
    expect(accrualShare(lease, '2026-10', { from: '2026-10-10', to: '2026-10-20' })).toEqual({ inside: 11, whole: 31 })
    expect(accrualShare(lease, '2026-09', OCT)).toEqual({ inside: 0, whole: 16 })
    expect(accrualShare({ mode: 'date', date: '2026-10-05' }, '2026-10', OCT)).toEqual({ inside: 1, whole: 1 })
    expect(accrualShare({ mode: 'date', date: '2026-09-30' }, '2026-09', OCT)).toEqual({ inside: 0, whole: 1 })
  })
})

describe('operationRollups', () => {
  it('keeps the days of the period, the payment months of the period and the accrual share of the period', () => {
    const sale = op({ type: 'income', accountId: 'main', amountMinor: 10_000, paymentDate: '2026-10-05', categoryId: 'ci' })
    const before = op({ type: 'expense', accountId: 'main', amountMinor: 2_000, paymentDate: '2026-09-28', categoryId: 'ce' })
    const lease = op({ type: 'expense', accountId: 'main', amountMinor: 61_000, paymentDate: '2026-10-12', accrual: { mode: 'period', from: '2026-09-15', to: '2026-11-14' } })
    const { docs, uncountable } = operationRollups([sale, before, lease], 'PLN', { from: '2026-10-10', to: '2026-10-20' }, { parts: ['cash', 'cashcat', 'pl'] })
    expect(uncountable).toEqual([])
    expect(Object.fromEntries(docs)).toEqual({
      'cash_main_2026-10-12': { outMinor: 61_000, outBase: 61_000 },
      'cashcat_2026-10': { 'categories._none.expenseBase': 61_000 },
      'pl_2026-10': { 'categories._none.expenseBase': 11_000 },
    })
  })

  it('the money in of a transfer counts on its arrival day; an account choice keeps only its own days', () => {
    const transfer = op({ type: 'transfer', accountId: 'main', toAccountId: 'vat', amountMinor: 30_000, paymentDate: '2026-09-28', toDate: '2026-10-02' })
    expect(Object.fromEntries(operationRollups([transfer], 'PLN', OCT, { parts: ['cash'] }).docs)).toEqual({ 'cash_vat_2026-10-02': { transferInMinor: 30_000 } })
    const inside = op({ type: 'transfer', accountId: 'main', toAccountId: 'vat', amountMinor: 5_000, paymentDate: '2026-10-09' })
    expect(Object.fromEntries(operationRollups([inside], 'PLN', OCT, { accounts: new Set(['main']), parts: ['cash'] }).docs)).toEqual({
      'cash_main_2026-10-09': { transferOutMinor: 5_000 },
    })
  })

  it('an excluded operation goes to the x_ documents; a planned one adds nothing', () => {
    const vat = op({ type: 'expense', accountId: 'main', amountMinor: 23_000, paymentDate: '2026-10-07', tags: ['vat'], excluded: true })
    const plan = op({ type: 'expense', accountId: 'main', amountMinor: 7_000, paymentDate: '2026-10-30', status: 'planned' })
    expect(Object.fromEntries(operationRollups([vat, plan], 'PLN', OCT, { parts: ['cash', 'pl'] }).docs)).toEqual({
      'x_cash_main_2026-10-07': { outMinor: 23_000, outBase: 23_000 },
      'x_pl_2026-10': { 'categories._none.expenseBase': 23_000 },
    })
  })

  it('an operation in another currency without base amounts is uncountable, never a zero', () => {
    const lost = op({ type: 'income', accountId: 'eur', currency: 'EUR', amountMinor: 5_000, paymentDate: '2026-10-10' })
    const result = operationRollups([lost], 'PLN', OCT, { parts: ['cash', 'cashcat', 'pl'] })
    expect(result.uncountable).toEqual([lost.id])
    expect(result.docs.size).toBe(0)
  })

  it('for whole months the P&L part is what the ledger stores', () => {
    const lease = op({ type: 'expense', accountId: 'main', amountMinor: 61_000, paymentDate: '2026-10-12', accrual: { mode: 'period', from: '2026-09-15', to: '2026-11-14' } })
    const stored = new Map([...contributions(lease, 'PLN')].filter(([id]) => id.startsWith('pl_')))
    expect(stored.get('pl_2026-09')).toEqual({ 'categories._none.expenseBase': 16_000 })
    expect(operationRollups([lease], 'PLN', { from: '2026-09-01', to: '2026-11-30' }, { parts: ['pl'] }).docs).toEqual(stored)
  })
})

describe('factsFromRollupDocs', () => {
  it('reads the cells and the categories; the x_ twins to the excluded side; other ids are ignored', () => {
    const facts = factsFromRollupDocs(
      new Map<string, RollupFlat>([
        ['cash_main_2026-10-05', { inMinor: 10_000, inBase: 10_000 }],
        ['x_cash_main_2026-10-07', { outMinor: 23_000, outBase: 23_000 }],
        ['cashcat_2026-10', { 'categories.ci.incomeBase': 10_000 }],
        ['cashcat_2026-11', { 'categories.ci.incomeBase': 500, 'categories._none.expenseBase': 300 }],
        ['x_pl_2026-10', { 'categories._none.expenseBase': 23_000 }],
        ['other', { inMinor: 1 }],
      ]),
    )
    expect(facts.cash.get('main')?.get('2026-10-05')).toEqual({ inMinor: 10_000, outMinor: 0, inBase: 10_000, outBase: 0, transferInMinor: 0, transferOutMinor: 0 })
    expect(facts.excludedCash.get('main')?.get('2026-10-07')?.outBase).toBe(23_000)
    expect(Object.fromEntries(facts.cashCategories)).toEqual({ ci: { incomeBase: 10_500, expenseBase: 0 }, _none: { incomeBase: 0, expenseBase: 300 } })
    expect(facts.excludedPl.get('2026-10')?.get('_none')).toEqual({ incomeBase: 0, expenseBase: 23_000 })
    expect(facts.pl.size).toBe(0)
  })
})

describe('selectRollupDocs', () => {
  it('keeps the days of the chosen accounts inside the period and the month documents of the report kind', () => {
    const docs = new Map<string, RollupFlat>([
      ['cash_main_2026-09-30', { inMinor: 1 }],
      ['cash_main_2026-10-01', { inMinor: 2 }],
      ['x_cash_vat_2026-10-31', { outMinor: 3 }],
      ['cash_gone_2026-10-02', { inMinor: 4 }],
      ['cashcat_2026-10', { 'categories.ci.incomeBase': 2 }],
      ['pl_2026-10', { 'categories.ci.incomeBase': 2 }],
      ['pl_2026-11', { 'categories.ci.incomeBase': 9 }],
    ])
    const accounts = new Set(['main', 'vat'])
    expect([...selectRollupDocs(docs, accounts, OCT, 'cashflow').keys()]).toEqual(['cash_main_2026-10-01', 'x_cash_vat_2026-10-31', 'cashcat_2026-10'])
    expect([...selectRollupDocs(docs, accounts, OCT, 'pl').keys()]).toEqual(['cash_main_2026-10-01', 'x_cash_vat_2026-10-31', 'pl_2026-10'])
  })
})

describe('reachesPeriod', () => {
  it('an operation on a day of the period reaches it; a transfer reaches it within the arrival days either side', () => {
    expect(reachesPeriod('2026-10-01', 'expense', OCT)).toBe(true)
    expect(reachesPeriod('2026-09-30', 'expense', OCT)).toBe(false)
    expect(reachesPeriod('2026-09-24', 'transfer', OCT)).toBe(true)
    expect(reachesPeriod('2026-09-23', 'transfer', OCT)).toBe(false)
    expect(reachesPeriod('2026-11-07', 'transfer', OCT)).toBe(true)
    expect(reachesPeriod('2026-11-08', 'transfer', OCT)).toBe(false)
  })
})
