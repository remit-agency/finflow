// lib/domain/reports/export.ts
// The export of a report (S12): the same response the page shows, as three sheets («Звіт», «За категоріями», «Звірка»),
// then a CSV with the journal's rules (BOM, `;`, CRLF, formula injection defused) or an XLSX (lib/server/reports/xlsx.ts).
// The words come from the caller (the message catalogs `reports.export`), so this file has no language of its own.
import { buildCsvSections, formatAmount } from '@/lib/domain/journal/csv'
import type { KindCategory } from '@/lib/domain/analytics-filter/kinds'
import { categoryTreeRows, rowRank } from './categories'
import { ratesNbpDidNotGive } from './reconcile'
import type { CashFlowReport, CategoryLine, MoneyType, PLReport, Reconciliation } from './types'

/** A text, or an amount in minor units (a number in XLSX, the language's decimal sign in CSV). */
export type ExportCell = string | { minor: number }

export interface ExportSheet {
  name: string
  header: string[]
  rows: ExportCell[][]
}

export interface ExportLabels {
  sheets: { report: string; categories: string; reconciliation: string }
  columns: {
    month: string
    day: string
    income: string
    expense: string
    net: string
    running: string
    category: string
    type: string
    amount: string
    total: string
    line: string
    account: string
    currency: string
    opening: string
    closing: string
    fx: string
  }
  types: { income: string; expense: string }
  rows: { total: string; totalIncome: string; totalExpense: string; profit: string; excludedIncome: string; excludedExpense: string; noCategory: string }
  lines: { opening: string; net: string; excluded: string; included: string; outside: string; transfers: string; fx: string; closing: string; discrepancy: string; unvalued: string; unrequested: string }
}

export interface ExportContext {
  labels: ExportLabels
  /** A day (`YYYY-MM-DD`) or a month (`YYYY-MM`) as the UI language writes it. */
  periodLabel: (key: string) => string
  /** The name of a report row: a category (a default one in the UI language) or the uncategorised row. */
  rowName: (row: string) => string
  accountName: (accountId: string) => string
  /** The company's categories, in the order the tree and the rows follow. */
  categories: readonly KindCategory[]
}

const INDENT = '    '

function money(minor: number | null): ExportCell {
  return minor === null ? '' : { minor }
}

function withCurrency(label: string, currency: string): string {
  return `${label}, ${currency}`
}

function categorySheet(lines: readonly CategoryLine[], currency: string, ctx: ExportContext): ExportSheet {
  const { labels } = ctx
  return {
    name: labels.sheets.categories,
    header: [labels.columns.category, labels.columns.type, withCurrency(labels.columns.amount, currency)],
    rows: categoryTreeRows(lines, ctx.categories).map((r) => [`${INDENT.repeat(r.level)}${ctx.rowName(r.row)}`, labels.types[r.type], money(r.amountBase)]),
  }
}

/** «Звірка»: the lines of the equation as the page shows them, then the accounts with their balances. */
export function reconciliationSheet(rec: Reconciliation, currency: string, ctx: ExportContext): ExportSheet {
  const { lines, columns } = ctx.labels
  const rows: ExportCell[][] = [
    [lines.opening, money(rec.openingBase)],
    [lines.net, money(rec.reportNetBase)],
    rec.excludedBase === null ? [lines.included, ''] : [lines.excluded, money(rec.excludedBase)],
  ]
  if (rec.outsideFilterBase !== 0) rows.push([lines.outside, money(rec.outsideFilterBase)])
  if (rec.transfersBase !== 0) rows.push([lines.transfers, money(rec.transfersBase)])
  if (rec.rates.length > 0) rows.push([lines.fx, money(rec.fxBase)])
  rows.push([lines.closing, money(rec.closingBase)])
  if (rec.discrepancyBase !== 0) rows.push([lines.discrepancy, money(rec.discrepancyBase)])
  const notGiven = ratesNbpDidNotGive(rec)
  if (notGiven.length > 0) rows.push([lines.unvalued, [...new Set(notGiven.map((m) => m.currency))].join(', ')])
  if (rec.unrequestedRates.length > 0) rows.push([lines.unrequested, String(rec.unrequestedRates.length)])
  rows.push([])
  rows.push([
    columns.account,
    columns.currency,
    columns.opening,
    columns.closing,
    withCurrency(columns.opening, currency),
    withCurrency(columns.closing, currency),
    withCurrency(columns.fx, currency),
  ])
  for (const a of rec.accounts) {
    rows.push([ctx.accountName(a.accountId), a.currency, money(a.openingMinor), money(a.closingMinor), money(a.openingBase), money(a.closingBase), money(a.fxBase)])
  }
  return { name: ctx.labels.sheets.reconciliation, header: [columns.line, withCurrency(columns.amount, currency)], rows }
}

export function cashFlowSheets(report: CashFlowReport, ctx: ExportContext): ExportSheet[] {
  const { columns, rows: names, lines, sheets } = ctx.labels
  const c = report.currency
  const body: ExportCell[][] = report.buckets.map((b) => [ctx.periodLabel(b.key), money(b.incomeBase), money(b.expenseBase), money(b.netBase), money(b.runningNetBase)])
  body.push([names.total, money(report.totals.incomeBase), money(report.totals.expenseBase), money(report.totals.netBase), ''])
  const excluded = report.excluded
  if (excluded !== null && (excluded.incomeBase !== 0 || excluded.expenseBase !== 0)) {
    body.push([lines.excluded, money(excluded.incomeBase), money(excluded.expenseBase), money(excluded.incomeBase - excluded.expenseBase), ''])
  }
  return [
    {
      name: sheets.report,
      header: [
        report.granularity === 'day' ? columns.day : columns.month,
        withCurrency(columns.income, c),
        withCurrency(columns.expense, c),
        withCurrency(columns.net, c),
        withCurrency(columns.running, c),
      ],
      rows: body,
    },
    categorySheet(report.categories, c, ctx),
    reconciliationSheet(report.reconciliation, c, ctx),
  ]
}

export function plSheets(report: PLReport, ctx: ExportContext): ExportSheet[] {
  const { columns, rows: names, types, sheets } = ctx.labels
  const c = report.currency
  const rank = rowRank(ctx.categories)
  const width = report.months.length
  const ordered = [...report.rows].sort((a, b) => (a.type === b.type ? rank(a.type, a.row) - rank(b.type, b.row) : a.type === 'income' ? -1 : 1))
  const columnSums = (type: MoneyType): number[] =>
    report.months.map((_, i) => report.rows.filter((r) => r.type === type).reduce((s, r) => s + r.values[i], 0))
  const income = columnSums('income')
  const expense = columnSums('expense')
  const body: ExportCell[][] = []
  for (const type of ['income', 'expense'] as const) {
    for (const r of ordered.filter((x) => x.type === type)) body.push([ctx.rowName(r.row), types[type], ...r.values.map(money), money(r.total)])
    body.push(
      type === 'income'
        ? [names.totalIncome, '', ...income.map(money), money(report.totals.incomeBase)]
        : [names.totalExpense, '', ...expense.map(money), money(report.totals.expenseBase)],
    )
  }
  body.push([names.profit, '', ...income.map((v, i) => money(v - expense[i])), money(report.totals.profitBase)])
  const blank = (): ExportCell[] => Array.from({ length: width }, (): ExportCell => '')
  if (report.excluded !== null && report.excluded.incomeBase !== 0) body.push([names.excludedIncome, '', ...blank(), money(report.excluded.incomeBase)])
  if (report.excluded !== null && report.excluded.expenseBase !== 0) body.push([names.excludedExpense, '', ...blank(), money(report.excluded.expenseBase)])
  return [
    { name: sheets.report, header: [columns.category, columns.type, ...report.months.map(ctx.periodLabel), withCurrency(columns.total, c)], rows: body },
    categorySheet(report.rows.map((r) => ({ row: r.row, type: r.type, amountBase: r.total })), c, ctx),
    reconciliationSheet(report.reconciliation, c, ctx),
  ]
}

/** The sheets as one CSV file: one section per sheet, amounts with `decimal` (the journal's CSV rules). */
export function sheetsToCsv(sheets: readonly ExportSheet[], decimal: ',' | '.'): string {
  const text = (cell: ExportCell): string => (typeof cell === 'string' ? cell : formatAmount(cell.minor, decimal))
  return buildCsvSections(sheets.map((s) => ({ title: s.name, header: s.header, rows: s.rows.map((row) => row.map(text)) })))
}
