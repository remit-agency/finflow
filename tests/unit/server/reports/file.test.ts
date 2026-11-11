import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { categoryTypesOf } from '@/lib/domain/analytics-filter/kinds'
import { reportFile } from '@/lib/server/reports/file'
import type { ReportContext } from '@/lib/server/reports/read'
import { CATEGORIES, sampleCashFlow, samplePL } from '../../domain/reports/fixtures'

const categories = [...CATEGORIES, { id: 'cat-sales', name: 'Продажі', type: 'income' as const }]
const CONTEXT: ReportContext = {
  baseCurrency: 'PLN',
  accounts: [{ id: 'main', name: 'Konto główne', type: 'bank', currency: 'PLN', color: '#00c896', openingMinor: 100_000, balanceMinor: 110_950 }],
  categories,
  categoryTypes: categoryTypesOf(categories),
}

describe('reportFile', () => {
  it('a CSV in Polish: the sheets under their Polish names, Polish day labels, a decimal comma, the period in the file name', async () => {
    const file = await reportFile(sampleCashFlow(), CONTEXT, 'csv', 'pl')
    expect(file.contentType).toBe('text/csv; charset=utf-8')
    expect(file.filename).toBe('cashflow-2026-10-01_2026-10-02.csv')
    const csv = file.body as string
    expect(csv.startsWith('﻿Raport\r\nDzień;Wpływy, PLN;')).toBe(true)
    expect(csv).toContain('\r\n1 paź;500,00;120,00;380,00;380,00\r\n')
    expect(csv).toContain('\r\n\r\nUzgodnienie\r\n')
    expect(csv).toContain('\r\nSaldo początkowe;1000,00\r\n')
    expect(csv).toContain('\r\nKonto główne;PLN;1000,00;1109,50;1000,00;1109,50;0,00\r\n')
  })

  it('a default category is named in the language of the file; the uncategorised row too', async () => {
    const report = sampleCashFlow()
    report.categories = [{ row: 'cat-sales', type: 'income', amountBase: 50_000 }, { row: '_none:expense', type: 'expense', amountBase: 16_050 }]
    const csv = (await reportFile(report, CONTEXT, 'csv', 'pl')).body as string
    expect(csv).toContain('\r\nSprzedaż;Wpływy;500,00\r\n')
    expect(csv).toContain('\r\nBez kategorii;Wydatki;160,50\r\n')
  })

  it('an XLSX in English: three sheets with English names and month labels', async () => {
    const file = await reportFile(samplePL(), CONTEXT, 'xlsx', 'en')
    expect(file.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(file.filename).toBe('pl-2026-09-01_2026-10-31.xlsx')
    const files = unzipSync(file.body as Uint8Array)
    const workbook = strFromU8(files['xl/workbook.xml'])
    for (const name of ['Report', 'By category', 'Reconciliation']) expect(workbook).toContain(`name="${name}"`)
    const strings = strFromU8(files['xl/sharedStrings.xml'])
    expect(strings).toContain('Sep 2026')
    expect(strings).toContain('No category')
  })
})
