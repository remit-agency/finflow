import { describe, expect, it } from 'vitest'
import { cashFlowSheets, plSheets, sheetsToCsv, type ExportContext } from '@/lib/domain/reports/export'
import { CATEGORIES, LABELS, sampleCashFlow, samplePL } from './fixtures'

const NAMES: Record<string, string> = { 'cat-in': 'Sprzedaż', 'cat-it': 'IT', 'cat-cloud': 'Chmura' }
const ctx: ExportContext = {
  labels: LABELS,
  periodLabel: (key) => `[${key}]`,
  rowName: (row) => NAMES[row] ?? LABELS.rows.noCategory,
  accountName: (id) => (id === 'main' ? 'Konto główne' : id),
  categories: CATEGORIES,
}

describe('the CSV of a subcategory named like a formula', () => {
  it('is defused after its indent: the guard reads the name, so no cell starts with «=» after the spaces', () => {
    const named = { ...ctx, rowName: (row: string) => (row === 'cat-cloud' ? '=HYPERLINK("https://example.test")' : ctx.rowName(row)) }
    const [, categories] = cashFlowSheets(sampleCashFlow(), named)
    const csv = sheetsToCsv([categories], '.')
    expect(csv).toContain("    '=HYPERLINK")
    expect(csv).not.toContain(' =HYPERLINK')
  })
})

describe('cashFlowSheets', () => {
  it('the report, by category and the reconciliation, with the numbers of the report', () => {
    const [report, categories, reconciliation] = cashFlowSheets(sampleCashFlow(), ctx)
    expect(report).toEqual({
      name: 'Report',
      header: ['Day', 'Money in, PLN', 'Money out, PLN', 'Net, PLN', 'Running total, PLN'],
      rows: [
        ['[2026-10-01]', { minor: 50_000 }, { minor: 12_000 }, { minor: 38_000 }, { minor: 38_000 }],
        ['[2026-10-02]', { minor: 0 }, { minor: 4_050 }, { minor: -4_050 }, { minor: 33_950 }],
        ['Total', { minor: 50_000 }, { minor: 16_050 }, { minor: 33_950 }, ''],
        ['Excluded from analytics', { minor: 0 }, { minor: 23_000 }, { minor: -23_000 }, ''],
      ],
    })
    expect(categories).toEqual({
      name: 'By category',
      header: ['Category', 'Type', 'Amount, PLN'],
      rows: [
        ['Sprzedaż', 'Money in', { minor: 50_000 }],
        ['IT', 'Money out', { minor: 16_050 }],
        ['    Chmura', 'Money out', { minor: 4_050 }],
      ],
    })
    expect(reconciliation).toEqual({
      name: 'Reconciliation',
      header: ['Line', 'Amount, PLN'],
      rows: [
        ['Opening balance', { minor: 100_000 }],
        ['Net movement in the report', { minor: 33_950 }],
        ['Excluded from analytics', { minor: -23_000 }],
        ['Closing balance', { minor: 110_950 }],
        [],
        ['Account', 'Currency', 'Opening balance', 'Closing balance', 'Opening balance, PLN', 'Closing balance, PLN', 'Exchange difference, PLN'],
        ['Konto główne', 'PLN', { minor: 100_000 }, { minor: 110_950 }, { minor: 100_000 }, { minor: 110_950 }, { minor: 0 }],
      ],
    })
  })

  it('a concrete tag, the operations outside the filter and a discrepancy are lines; a missing rate is named', () => {
    const tagged = sampleCashFlow()
    tagged.reconciliation = { ...tagged.reconciliation, excludedBase: null, excludedIncluded: true, outsideFilterBase: 500, discrepancyBase: 7 }
    expect(cashFlowSheets(tagged, ctx)[2].rows.slice(0, 6)).toEqual([
      ['Opening balance', { minor: 100_000 }],
      ['Net movement in the report', { minor: 33_950 }],
      ['The excluded operations are already in the figures', ''],
      ['Operations outside the filter', { minor: 500 }],
      ['Closing balance', { minor: 110_950 }],
      ['Discrepancy', { minor: 7 }],
    ])
    const unvalued = sampleCashFlow()
    unvalued.reconciliation = {
      ...unvalued.reconciliation,
      valued: false,
      missingRates: [{ currency: 'EUR', date: '2026-10-03' }],
      fxBase: null,
      discrepancyBase: null,
      rates: [{ currency: 'EUR', opening: null, closing: null }],
    }
    expect(cashFlowSheets(unvalued, ctx)[2].rows.slice(3, 7)).toEqual([
      ['Exchange difference', ''],
      ['Closing balance', { minor: 110_950 }],
      ['Discrepancy', ''],
      ['No NBP rate:', 'EUR'],
    ])
  })
})

describe('plSheets', () => {
  it('months as columns in the order of the categories, totals, profit and the excluded rows', () => {
    const [report, categories, reconciliation] = plSheets(samplePL(), ctx)
    expect(report.name).toBe('Report')
    expect(report.header).toEqual(['Category', 'Type', '[2026-09]', '[2026-10]', 'Total, PLN'])
    expect(report.rows).toEqual([
      ['Sprzedaż', 'Money in', { minor: 0 }, { minor: 50_000 }, { minor: 50_000 }],
      ['Total income', '', { minor: 0 }, { minor: 50_000 }, { minor: 50_000 }],
      ['IT', 'Money out', { minor: 0 }, { minor: 12_000 }, { minor: 12_000 }],
      ['No category', 'Money out', { minor: 1_000 }, { minor: 2_000 }, { minor: 3_000 }],
      ['Total expenses', '', { minor: 1_000 }, { minor: 14_000 }, { minor: 15_000 }],
      ['Profit / loss', '', { minor: -1_000 }, { minor: 36_000 }, { minor: 35_000 }],
      ['Excluded from analytics: expenses', '', '', '', { minor: 23_000 }],
    ])
    expect(categories.rows).toEqual([
      ['Sprzedaż', 'Money in', { minor: 50_000 }],
      ['IT', 'Money out', { minor: 12_000 }],
      ['No category', 'Money out', { minor: 3_000 }],
    ])
    expect(reconciliation.name).toBe('Reconciliation')
  })
})

describe('sheetsToCsv', () => {
  it('the sheets one after another under their names, ; separated, with the decimal sign of the language', () => {
    const csv = sheetsToCsv(cashFlowSheets(sampleCashFlow(), ctx), ',')
    expect(csv.startsWith('﻿Report\r\nDay;Money in, PLN;')).toBe(true)
    expect(csv).toContain('\r\n[2026-10-02];0,00;40,50;-40,50;339,50\r\n')
    expect(csv).toContain('\r\n\r\nBy category\r\nCategory;Type;Amount, PLN\r\n')
    expect(csv).toContain('\r\nOpening balance;1000,00\r\n')
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(sheetsToCsv(cashFlowSheets(sampleCashFlow(), ctx), '.')).toContain('\r\nOpening balance;1000.00\r\n')
  })

  it('a cell that starts like a formula is defused; a negative amount stays a number', () => {
    expect(sheetsToCsv([{ name: 'S', header: ['A'], rows: [['=HYPERLINK("x")'], [{ minor: -1 }]] }], ',')).toBe('﻿S\r\nA\r\n"\'=HYPERLINK(""x"")"\r\n-0,01\r\n')
  })
})
