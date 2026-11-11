import { baseOf } from '@/lib/domain/ledger/build'
import type { JournalRow } from './types'

/** Column keys, in file order; the header labels come from `journal.export.columns.<key>` in the message catalogs. */
export const EXPORT_COLUMNS = [
  'paymentDate',
  'accrualFrom',
  'accrualTo',
  'status',
  'type',
  'account',
  'toAccount',
  'category',
  'counterparty',
  'comment',
  'tags',
  'amount',
  'currency',
  'amountBase',
  'rate',
  'rateDate',
  'balanceAfter',
] as const

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

export interface ExportContext {
  /** The decimal sign of the language: ',' for pl and uk, '.' for en. */
  decimal: ',' | '.'
  accountName: (id: string) => string
  categoryName: (id: string) => string
  counterpartyName: (id: string) => string
  /** The name of a tag (S10t). */
  tagName: (id: string) => string
  statusLabel: (status: string) => string
  typeLabel: (type: string) => string
  baseCurrency: string
}

const DELIMITER = ';'

/** Minor units with two decimals, the language's decimal sign and no thousands separator. */
export function formatAmount(minor: number, decimal: ',' | '.'): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}${decimal}${frac}`
}

/** A plain signed number such as an amount: spreadsheets read it as a number, so it is not a formula. */
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/

/** Quotes where needed and defuses spreadsheet formulas (a cell that starts with = + - @ or a tab). */
/**
 * A text a spreadsheet would read as a formula gets a `'` in front. The check looks past leading spaces (the indent of a
 * subcategory in a report), and the apostrophe goes after them: the spaces stay where they were.
 */
export function csvCell(value: string): string {
  const core = value.replace(/^ +/, '')
  const defuse = /^[=+\-@\t\r]/.test(core) && !PLAIN_NUMBER.test(core)
  const safe = defuse ? `${value.slice(0, value.length - core.length)}'${core}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** UTF-8 BOM so Excel reads the diacritics, `;` as the delimiter, CRLF line ends. */
export function buildCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(DELIMITER))
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * Several tables in one file (the sheets of a report, S12): each under its title row, an empty line between them; the
 * cells, the delimiter, the BOM and the line ends of `buildCsv`.
 */
export function buildCsvSections(sections: ReadonlyArray<{ title: string; header: string[]; rows: string[][] }>): string {
  const lines = sections.flatMap((s, i) => [
    ...(i === 0 ? [] : ['']),
    csvCell(s.title),
    ...[s.header, ...s.rows].map((cells) => cells.map(csvCell).join(DELIMITER)),
  ])
  return `﻿${lines.join('\r\n')}\r\n`
}

export function exportRow({ tx, balanceAfterMinor }: JournalRow, ctx: ExportContext): string[] {
  const accrual = tx.accrual.mode === 'date' ? { from: tx.accrual.date, to: tx.accrual.date } : { from: tx.accrual.from, to: tx.accrual.to }
  const sign = tx.type === 'income' ? 1 : -1
  const base = tx.type === 'transfer' ? null : baseOf(tx, ctx.baseCurrency)
  const evidence = tx.fx?.payment
  const cells: Record<ExportColumn, string> = {
    paymentDate: tx.paymentDate,
    accrualFrom: tx.type === 'transfer' ? '' : accrual.from,
    accrualTo: tx.type === 'transfer' ? '' : accrual.to,
    status: ctx.statusLabel(tx.status),
    type: ctx.typeLabel(tx.type),
    account: ctx.accountName(tx.accountId),
    toAccount: tx.toAccountId === undefined ? '' : ctx.accountName(tx.toAccountId),
    category: tx.categoryId === undefined ? '' : ctx.categoryName(tx.categoryId),
    counterparty: tx.counterpartyId === undefined ? '' : ctx.counterpartyName(tx.counterpartyId),
    comment: tx.description ?? '',
    tags: tx.tags.map(ctx.tagName).join(', '),
    amount: formatAmount(sign * tx.amountMinor, ctx.decimal),
    currency: tx.currency,
    amountBase: base ? formatAmount(sign * base.payment, ctx.decimal) : '',
    rate: evidence ? String(evidence.rate).replace('.', ctx.decimal) : '',
    rateDate: evidence?.rateDate ?? '',
    balanceAfter: balanceAfterMinor === null ? '' : formatAmount(balanceAfterMinor, ctx.decimal),
  }
  return EXPORT_COLUMNS.map((c) => cells[c])
}
