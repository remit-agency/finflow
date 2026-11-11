import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS } from '@/lib/domain/analytics-filter/filter'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { ReportQuery } from '@/lib/domain/reports/types'
import { FxError } from '@/lib/server/fx/types'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { accountRowGap } from '@/lib/domain/reports/cashflow'
import { createTransaction } from '@/lib/server/ledger/write'
import { readCashFlowReport, readPLReport } from '@/lib/server/reports/read'
import { ORG, UID, makeDeps, testDb } from './helpers'
import { seedReportCompany, steppedRate } from './report-helpers'

const db = testDb()
const deps = makeDeps(db, { resolveRate: steppedRate })
const OCT: ReportQuery = { from: '2026-10-01', to: '2026-10-31', filters: EMPTY_ANALYTICS_FILTERS }
const withoutCoverage = <T extends { coverage: unknown }>(report: T) => ({ ...report, coverage: null })

beforeEach(async () => {
  await seedReportCompany(db, deps)
})

describe('Cash Flow on the server (S12)', () => {
  it('whole months from the rollups equal the same report from the operations; verifyLedger is clean', async () => {
    const fromRollups = await readCashFlowReport(deps, ORG, OCT)
    const fromOperations = await readCashFlowReport(deps, ORG, OCT, { source: 'operations' })
    expect(fromRollups.report.coverage.source).toBe('rollups')
    expect(fromOperations.report.coverage).toMatchObject({ source: 'operations', uncountable: 0 })
    expect(withoutCoverage(fromRollups.report)).toEqual(withoutCoverage(fromOperations.report))
    expect(fromRollups.report.totals).toEqual({ incomeBase: 71_000, expenseBase: 12_000, netBase: 59_000 })
    expect(fromRollups.report.excluded).toEqual({ incomeBase: 0, expenseBase: 23_000 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('from the rollups it reads the daily documents of the period and two month documents, never the operations of the period', async () => {
    const { stats, report } = await readCashFlowReport(deps, ORG, OCT)
    // pln: the 5th, the 6th, the 20th and the x_ twin of the 7th; eur: the 10th and the 20th; cashcat_ and x_cashcat_ of October.
    expect(stats.rollups).toBe(8)
    expect(report.coverage).toMatchObject({ source: 'rollups', rollupsRead: 8, uncountable: null })
  })

  it('the reconciliation adds up across currencies: the exchange difference of the EUR account, the transfer in PLN at the NBP rate', async () => {
    const { reconciliation } = (await readCashFlowReport(deps, ORG, OCT)).report
    expect(reconciliation).toMatchObject({
      openingDay: '2026-09-30', closingDay: '2026-10-27', valued: true,
      openingBase: 140_000, reportNetBase: 59_000, excludedBase: -23_000, outsideFilterBase: 0,
      transfersBase: 1_000, fxBase: 5_000, closingBase: 182_000, discrepancyBase: 0,
    })
    expect(reconciliation.accounts.find((a) => a.accountId === 'eur')).toMatchObject({ openingMinor: 10_000, closingMinor: 25_000, fxBase: 5_000 })
  })

  it('every account row closes on the emulator: opening + in - out + transfers + excluded = closing (the excluded VAT of pln included)', async () => {
    const { report } = await readCashFlowReport(deps, ORG, OCT)
    expect(report.accounts.map((line) => accountRowGap(line))).toEqual([0, 0])
    // pln: 1000 zł at the close of 30 September; +500 - 120 - 230 (excluded) - 430 (transfer out) in October: 720 zł.
    expect(report.accounts.find((line) => line.accountId === 'pln')).toMatchObject({ openingMinor: 100_000, closingMinor: 72_000, excludedNetMinor: -23_000 })
  })

  it('with a category filter the rows show the movement only: no balances to close', async () => {
    const { report } = await readCashFlowReport(deps, ORG, { ...OCT, filters: { ...EMPTY_ANALYTICS_FILTERS, categoryIds: ['k-in'] } })
    expect(report.accounts.every((line) => line.openingMinor === null && line.closingMinor === null)).toBe(true)
  })

  it('a concrete tag counts the excluded operation; the rest of the accounts is outside the filter', async () => {
    const { report } = await readCashFlowReport(deps, ORG, { ...OCT, filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } })
    expect(report.coverage.source).toBe('operations')
    expect(report.totals).toEqual({ incomeBase: 0, expenseBase: 23_000, netBase: -23_000 })
    expect([report.excluded, report.excludedCounted]).toEqual([null, true])
    expect(report.reconciliation).toMatchObject({ excludedIncluded: true, excludedBase: null, reportNetBase: -23_000, outsideFilterBase: 59_000, discrepancyBase: 0 })
  })

  it('one account: its line only, and its transfers with the other accounts are a reconciliation line', async () => {
    const { report } = await readCashFlowReport(deps, ORG, { ...OCT, filters: { ...EMPTY_ANALYTICS_FILTERS, accountIds: ['eur'] } })
    expect(report.accounts.map((a) => a.accountId)).toEqual(['eur'])
    expect(report.totals.incomeBase).toBe(21_000)
    expect(report.reconciliation).toMatchObject({ openingBase: 40_000, reportNetBase: 21_000, transfersBase: 44_000, fxBase: 5_000, closingBase: 110_000, discrepancyBase: 0 })
  })

  it('a planned operation is in no report', async () => {
    const cashFlow = (await readCashFlowReport(deps, ORG, OCT, { source: 'operations' })).report
    expect(cashFlow.totals.expenseBase).toBe(12_000)
    const pl = (await readPLReport(deps, ORG, OCT, { source: 'operations' })).report
    expect(pl.totals.expenseBase).toBe(12_000)
  })

  it('above the read limit the answer is a refusal with the cap, never a partial figure', async () => {
    const tagged: ReportQuery = { ...OCT, filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } }
    await expect(readCashFlowReport(deps, ORG, tagged, { cap: 3 })).rejects.toMatchObject({ code: 'too_many_operations', cap: 3 })
    await expect(readCashFlowReport(deps, ORG, OCT, { cap: 3 })).rejects.toMatchObject({ code: 'too_many_operations', cap: 3 })
    expect((await readCashFlowReport(deps, ORG, tagged, { cap: 50 })).report.totals.expenseBase).toBe(23_000)
  })

  it('refuses before any document is read: the operations of every query are counted first (the P&L of the review)', async () => {
    // Filtered P&L: 5 actual payments in the margin-wide window and 6 accrual-day operations (the planned one included) make 11.
    // With a cap of 10 the refusal must come from the counts alone; the old code read the payments first and refused after.
    const tagged: ReportQuery = { ...OCT, filters: { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] } }
    const reads: string[] = []
    await expect(readPLReport(deps, ORG, tagged, { cap: 10, onRead: (kind) => reads.push(kind) })).rejects.toMatchObject({ code: 'too_many_operations', cap: 10 })
    expect(reads.filter((kind) => kind === 'query' || kind === 'getAll')).toEqual([])
    // Four counts before the refusal: the payments, the accrual days and both shapes of the accrual periods (one is then read).
    expect(reads).toEqual(['aggregate', 'aggregate', 'aggregate', 'aggregate'])
    expect((await readPLReport(deps, ORG, tagged, { cap: 11 })).report.totals.expenseBase).toBe(23_000)
  })

  it('a refused Cash Flow reads no document either: the count of the rollups comes before them', async () => {
    const reads: string[] = []
    await expect(readCashFlowReport(deps, ORG, OCT, { cap: 7, onRead: (kind) => reads.push(kind) })).rejects.toMatchObject({ code: 'too_many_operations' })
    expect(reads.filter((kind) => kind === 'query' || kind === 'getAll')).toEqual([])
  })

  it('the coverage counts each operation document once: the payments, the accrual days and the arrival reads together', async () => {
    // Actual payments in the margin window: 5. Accrual days of October: the same 5 and the planned one (6): 11 reads, 6 documents.
    const { report, stats } = await readPLReport(deps, ORG, OCT, { source: 'operations' })
    expect(report.coverage).toMatchObject({ source: 'operations', operationsRead: 6 })
    expect(stats).toMatchObject({ operations: 6, reads: 11 })
  })

  it('an accrual period that starts after the period is not read (no upper bound was set on the period query)', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({
      type: 'expense', status: 'planned', accountId: 'pln', amountMinor: 1_000, paymentDate: '2026-10-30', categoryId: 'k-ex',
      accrual: { mode: 'period', from: '2029-01-01', to: '2029-12-31' },
    }))
    const { report } = await readPLReport(deps, ORG, OCT, { source: 'operations' })
    expect(report.coverage.operationsRead).toBe(6)
    expect(report.rows.find((r) => r.row === 'k-ex')?.total).toBe(12_000)
  })

  it('an unreadable payment counts as uncountable only when it can change the period', async () => {
    // Malformed (no schemaVersion): before the period by 6 days, not a transfer, so it cannot reach October; and in October.
    await testDb().doc(`organizations/${ORG}/transactions/bad-before`).set({ status: 'actual', type: 'expense', accountId: 'pln', paymentDate: '2026-09-25', amountMinor: 1 })
    await testDb().doc(`organizations/${ORG}/transactions/bad-inside`).set({ status: 'actual', type: 'expense', accountId: 'pln', paymentDate: '2026-10-03', amountMinor: 1 })
    const { report } = await readCashFlowReport(deps, ORG, OCT, { source: 'operations' })
    expect(report.coverage).toMatchObject({ uncountable: 1 })
  })

  it('the coverage counts the operations that reach the period: a payment the margin reads, outside the period, is read but not counted', async () => {
    // 25 September: outside October and not a transfer, so it is read by the payments window (7 days before) and changes nothing.
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'pln', amountMinor: 1_000, paymentDate: '2026-09-25', categoryId: 'k-ex' }))
    const { report, stats } = await readCashFlowReport(deps, ORG, OCT, { source: 'operations' })
    expect(stats.operations).toBe(6)
    expect(report.coverage).toMatchObject({ operationsRead: 5, uncountable: 0 })
  })

  it('a missing NBP rate leaves the reconciliation unvalued and names it; the figures of the report stay', async () => {
    const down = makeDeps(db, {
      resolveRate: async (from, to, date) => {
        if (from !== to) throw new FxError('provider_unavailable')
        return steppedRate(from, to, date)
      },
    })
    const { report } = await readCashFlowReport(down, ORG, OCT)
    expect(report.totals.netBase).toBe(59_000)
    expect(report.reconciliation).toMatchObject({ valued: false, discrepancyBase: null })
    expect(report.reconciliation.missingRates).toEqual([
      { currency: 'EUR', date: '2026-10-01' },
      { currency: 'EUR', date: '2026-10-20' },
      { currency: 'EUR', date: '2026-10-28' },
    ])
  })

  it('a report that needs more NBP months than the bound is answered: the rates past it are not asked, counted and unvalued', async () => {
    const asked: string[] = []
    const counting = makeDeps(db, {
      resolveRate: async (from, to, date) => {
        if (from !== to) asked.push(date)
        return steppedRate(from, to, date)
      },
    })
    // One month of tables: the opening valuation (the table of September) is asked; the closing one and the transfer of October are not.
    const { report } = await readCashFlowReport(counting, ORG, OCT, { rateMonths: 1 })
    expect(report.totals.netBase).toBe(59_000)
    expect(asked).toEqual(['2026-10-01'])
    expect(report.reconciliation).toMatchObject({ valued: false, discrepancyBase: null })
    expect(report.reconciliation.unrequestedRates).toEqual([
      { currency: 'EUR', date: '2026-10-20' },
      { currency: 'EUR', date: '2026-10-28' },
    ])
    expect(report.reconciliation.missingRates).toEqual(report.reconciliation.unrequestedRates)
  })
})

describe('P&L on the server (S12)', () => {
  it('an accrual period: whole months from the rollups equal the operations; a part of a month is its share of the days', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({
      type: 'expense', accountId: 'pln', amountMinor: 61_000, paymentDate: '2026-10-12', categoryId: 'k-ex', accrual: { mode: 'period', from: '2026-09-15', to: '2026-11-14' },
    }))
    const quarter: ReportQuery = { from: '2026-09-01', to: '2026-11-30', filters: EMPTY_ANALYTICS_FILTERS }
    const fromRollups = await readPLReport(deps, ORG, quarter)
    const fromOperations = await readPLReport(deps, ORG, quarter, { source: 'operations' })
    expect(withoutCoverage(fromRollups.report)).toEqual(withoutCoverage(fromOperations.report))
    expect(fromRollups.report.months).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(fromRollups.report.rows.find((r) => r.row === 'k-ex')?.values).toEqual([16_000, 12_000 + 31_000, 14_000])
    const part = await readPLReport(deps, ORG, { from: '2026-10-10', to: '2026-10-20', filters: EMPTY_ANALYTICS_FILTERS })
    expect(part.report.coverage.source).toBe('operations')
    expect(part.report.rows.find((r) => r.row === 'k-ex')?.values).toEqual([11_000])
  })

  it('the P&L has the same reconciliation as the Cash Flow of the period', async () => {
    const pl = (await readPLReport(deps, ORG, OCT)).report
    const cashFlow = (await readCashFlowReport(deps, ORG, OCT)).report
    expect(pl.reconciliation).toEqual(cashFlow.reconciliation)
  })

  it('a period that starts years before the period and ends inside it is found by the operations path', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({
      type: 'expense', accountId: 'pln', amountMinor: 31_000, paymentDate: '2026-10-03', categoryId: 'k-ex',
      accrual: { mode: 'period', from: '2024-01-01', to: '2026-10-15' },
    }))
    const fromRollups = await readPLReport(deps, ORG, OCT)
    const fromOperations = await readPLReport(deps, ORG, OCT, { source: 'operations' })
    expect(withoutCoverage(fromOperations.report)).toEqual(withoutCoverage(fromRollups.report))
    expect(fromOperations.report.rows.find((r) => r.row === 'k-ex')?.total).toBeGreaterThan(12_000)
  })

  it('a period that starts inside the period and ends years after it is found by the operations path', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({
      type: 'expense', accountId: 'pln', amountMinor: 31_000, paymentDate: '2026-10-21', categoryId: 'k-ex',
      accrual: { mode: 'period', from: '2026-10-20', to: '2028-06-30' },
    }))
    const fromRollups = await readPLReport(deps, ORG, OCT)
    const fromOperations = await readPLReport(deps, ORG, OCT, { source: 'operations' })
    expect(withoutCoverage(fromOperations.report)).toEqual(withoutCoverage(fromRollups.report))
    expect(fromOperations.report.rows.find((r) => r.row === 'k-ex')?.total).toBeGreaterThan(12_000)
  })

  it('the operations path reads the cheaper period shape: a history of periods that ended before the period costs no read', async () => {
    const before = (await readPLReport(deps, ORG, OCT, { source: 'operations' })).stats.reads
    for (let i = 0; i < 40; i++) {
      await createTransaction(deps, ORG, UID, parseTransactionInput({
        type: 'expense', accountId: 'pln', amountMinor: 1_000, paymentDate: '2026-09-15', categoryId: 'k-ex',
        accrual: { mode: 'period', from: '2026-08-01', to: '2026-08-31' },
      }))
    }
    // A cap of the reads before the history: the history is not read, so the answer is not refused.
    const after = await readPLReport(deps, ORG, OCT, { source: 'operations', cap: before })
    expect(after.stats.reads).toBe(before)
  })

  it('the operations path reads the cheaper period shape: a history of periods that start after the period costs no read', async () => {
    const before = (await readPLReport(deps, ORG, OCT, { source: 'operations' })).stats.reads
    for (let i = 0; i < 40; i++) {
      await createTransaction(deps, ORG, UID, parseTransactionInput({
        type: 'expense', status: 'planned', accountId: 'pln', amountMinor: 1_000, paymentDate: '2026-11-02', categoryId: 'k-ex',
        accrual: { mode: 'period', from: '2026-11-01', to: '2026-11-30' },
      }))
    }
    const after = await readPLReport(deps, ORG, OCT, { source: 'operations', cap: before })
    expect(after.stats.reads).toBe(before)
  })

  it('a malformed period that ends before the report is neither uncountable nor an operation of the report', async () => {
    // Three planned operations of November make the start shape the cheaper one to read, and that shape finds the August period
    // (it starts in the window); the period ends before October, so it cannot change the report.
    for (let i = 0; i < 3; i++) {
      await createTransaction(deps, ORG, UID, parseTransactionInput({
        type: 'expense', status: 'planned', accountId: 'pln', amountMinor: 1_000, paymentDate: '2026-11-02', categoryId: 'k-ex',
        accrual: { mode: 'period', from: '2026-11-01', to: '2026-11-30' },
      }))
    }
    await testDb().doc(`organizations/${ORG}/transactions/bad-august`).set({
      status: 'actual', type: 'expense', accountId: 'pln', paymentDate: '2026-09-15', amountMinor: 1, accrual: { mode: 'period', from: '2026-08-01', to: '2026-08-31' },
    })
    const { report, stats } = await readPLReport(deps, ORG, OCT, { source: 'operations' })
    expect(stats.operations).toBe(7)
    expect(report.coverage).toMatchObject({ uncountable: 0, operationsRead: 6 })
  })
})
