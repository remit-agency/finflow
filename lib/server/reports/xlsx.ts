import 'server-only'
import writeExcelFile, { type Cell } from 'write-excel-file/node'
import type { ExportCell, ExportSheet } from '@/lib/domain/reports/export'

const AMOUNT_FORMAT = '#,##0.00'

function cellOf(cell: ExportCell): Cell {
  // A text stays a text even when it starts with «=»: write-excel-file writes a formula only for `type: 'Formula'`.
  return typeof cell === 'string' ? cell : { value: cell.minor / 100, type: Number, format: AMOUNT_FORMAT }
}

/**
 * The sheets of a report as an `.xlsx` file in memory (S12): the header row bold and frozen, amounts as numbers with two
 * decimals. A report is a few hundred cells, so no stream is needed.
 */
export async function renderXlsx(sheets: readonly ExportSheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await writeExcelFile(
    sheets.map((s) => ({
      sheet: s.name,
      stickyRowsCount: 1,
      columns: s.header.map((_, i) => ({ width: i === 0 ? 40 : 18 })),
      data: [s.header.map((h): Cell => ({ value: h, fontWeight: 'bold' })), ...s.rows.map((row) => row.map(cellOf))],
    })),
  ).toBuffer()
  return new Uint8Array(buffer)
}
