// tests/unit/domain/reports/fixtures.ts
// Operations, categories, export labels and sample reports for the S12 domain and server tests.
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import type { ReportCategory } from '@/lib/domain/reports/categories'
import type { ExportLabels } from '@/lib/domain/reports/export'
import type { CashFlowReport, PLReport, Reconciliation } from '@/lib/domain/reports/types'

let seq = 0

/** An actual operation in PLN with its accrual on the payment day; `fields` overrides any of it. A transfer gets the same amount in. */
export function op(fields: Pick<LedgerTransaction, 'type' | 'accountId' | 'amountMinor' | 'paymentDate'> & Partial<LedgerTransaction>): LedgerTransaction {
  seq += 1
  const tx: LedgerTransaction = {
    id: `t${seq}`,
    status: 'actual',
    currency: 'PLN',
    accrual: { mode: 'date', date: fields.paymentDate },
    isRecurring: false,
    tags: [],
    fileUrls: [],
    ...fields,
  }
  if (tx.type === 'transfer') {
    tx.toAmountMinor ??= tx.amountMinor
    tx.toCurrency ??= tx.currency
  }
  return tx
}

/** «Sprzedaż» (income) and «IT» (expense) with the child «Chmura». */
export const CATEGORIES: ReportCategory[] = [
  { id: 'cat-in', name: 'Sprzedaż', type: 'income' },
  { id: 'cat-it', name: 'IT', type: 'expense' },
  { id: 'cat-cloud', name: 'Chmura', type: 'expense', parentId: 'cat-it' },
]

export const LABELS: ExportLabels = {
  sheets: { report: 'Report', categories: 'By category', reconciliation: 'Reconciliation' },
  columns: {
    month: 'Month', day: 'Day', income: 'Money in', expense: 'Money out', net: 'Net', running: 'Running total', category: 'Category', type: 'Type',
    amount: 'Amount', total: 'Total', line: 'Line', account: 'Account', currency: 'Currency', opening: 'Opening balance', closing: 'Closing balance', fx: 'Exchange difference',
  },
  types: { income: 'Money in', expense: 'Money out' },
  rows: {
    total: 'Total', totalIncome: 'Total income', totalExpense: 'Total expenses', profit: 'Profit / loss',
    excludedIncome: 'Excluded from analytics: income', excludedExpense: 'Excluded from analytics: expenses', noCategory: 'No category',
  },
  lines: {
    opening: 'Opening balance', net: 'Net movement in the report', excluded: 'Excluded from analytics', included: 'The excluded operations are already in the figures',
    outside: 'Operations outside the filter', transfers: 'Transfers between accounts', fx: 'Exchange difference', closing: 'Closing balance', discrepancy: 'Discrepancy', unvalued: 'No NBP rate:',
  },
}

/** One PLN account «main» from 1000 zł: 500 in, 160.50 out, 230 excluded, so 1109.50 at the end. */
export function sampleReconciliation(): Reconciliation {
  return {
    openingDay: '2026-09-30', closingDay: '2026-10-02', valued: true, missingRates: [],
    openingBase: 100_000, reportNetBase: 33_950, excludedBase: -23_000, excludedIncluded: false, outsideFilterBase: 0,
    transfersBase: 0, fxBase: 0, closingBase: 110_950, discrepancyBase: 0,
    accounts: [{ accountId: 'main', currency: 'PLN', openingMinor: 100_000, closingMinor: 110_950, movementMinor: 10_950, openingBase: 100_000, closingBase: 110_950, transfersBase: 0, fxBase: 0 }],
    rates: [],
  }
}

export function sampleCashFlow(): CashFlowReport {
  return {
    kind: 'cashflow', from: '2026-10-01', to: '2026-10-02', currency: 'PLN', granularity: 'day',
    totals: { incomeBase: 50_000, expenseBase: 16_050, netBase: 33_950 },
    buckets: [
      { key: '2026-10-01', incomeBase: 50_000, expenseBase: 12_000, netBase: 38_000, runningNetBase: 38_000 },
      { key: '2026-10-02', incomeBase: 0, expenseBase: 4_050, netBase: -4_050, runningNetBase: 33_950 },
    ],
    accounts: [{ accountId: 'main', inMinor: 50_000, outMinor: 16_050, transferInMinor: 0, transferOutMinor: 0 }],
    categories: [
      { row: 'cat-in', type: 'income', amountBase: 50_000 },
      { row: 'cat-it', type: 'expense', amountBase: 12_000 },
      { row: 'cat-cloud', type: 'expense', amountBase: 4_050 },
    ],
    excluded: { incomeBase: 0, expenseBase: 23_000 }, includeExcluded: false, excludedCounted: false,
    reconciliation: sampleReconciliation(),
    coverage: { source: 'rollups', operationsRead: 0, rollupsRead: 4, uncountable: null },
  }
}

export function samplePL(): PLReport {
  return {
    kind: 'pl', from: '2026-09-01', to: '2026-10-31', currency: 'PLN', months: ['2026-09', '2026-10'],
    rows: [
      { row: 'cat-in', type: 'income', values: [0, 50_000], total: 50_000 },
      { row: '_none:expense', type: 'expense', values: [1_000, 2_000], total: 3_000 },
      { row: 'cat-it', type: 'expense', values: [0, 12_000], total: 12_000 },
    ],
    totals: { incomeBase: 50_000, expenseBase: 15_000, profitBase: 35_000 },
    excluded: { incomeBase: 0, expenseBase: 23_000 }, includeExcluded: false, excludedCounted: false,
    reconciliation: sampleReconciliation(),
    coverage: { source: 'rollups', operationsRead: 0, rollupsRead: 6, uncountable: null },
  }
}
