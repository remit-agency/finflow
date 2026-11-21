import { describe, expect, it } from 'vitest'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import { makeXlsx, type Cell } from '@/tests/helpers/make-xlsx'

// Synthetic export of about the owner's size (not a copy of it). Checks counts only, no timing.
// Takes about 2 s (building the workbook included), so it runs only with FINMAP_LARGE=1
// (PowerShell: $env:FINMAP_LARGE='1'; npx vitest run <this file>).
const HEADER: Cell[] = [
  'Data płatności', 'Data zaksięgowania', 'Okres księgowania – data od', 'Okres księgowania – data do',
  'Kwota w walucie konta', 'Kwota w walucie firmy', 'Z konta', 'Na konto',
  'Kategoria', 'Podkategoria', 'Kontrahent', 'Podkontrahent', 'Projekt', 'Podprojekt', 'Tagi', 'Komentarz',
]
const ROWS = 40_000

function dataRow(i: number): Cell[] {
  const serial = 46000 + (i % 400) + ((i * 37) % 1440) / 1440
  return [
    serial, '', '01.11.2026', '30.11.2026',
    `${(i * 13) % 100000}.${i % 100}`, '', `Konto ${i % 7}`, `Konto ${i % 5}`,
    `Kategoria ${i % 20}`, '', `Kontrahent ${i % 300}`, '', '', '', `tag${i % 9}, tag${(i % 9) + 1}`, `komentarz ${i}`,
  ]
}

describe.skipIf(process.env.FINMAP_LARGE !== '1')('Finmap reading at the owner\'s size', () => {
  it('reads a 40 000-row export into 40 000 rows', () => {
    const sheet: Cell[][] = [HEADER]
    for (let i = 0; i < ROWS; i++) sheet.push(dataRow(i))
    const bytes = makeXlsx(sheet, { shared: true })
    const { rows, issues } = parseFinmapTable(readXlsxTable(bytes))
    expect(issues).toEqual([])
    expect(rows).toHaveLength(ROWS)
    expect(rows[ROWS - 1].line).toBe(ROWS + 1)
  })
})
