import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { renderXlsx } from '@/lib/server/reports/xlsx'

describe('renderXlsx', () => {
  it('one sheet per report sheet under its name, texts as strings (never formulas), amounts as numbers', async () => {
    const bytes = await renderXlsx([
      { name: 'Звіт', header: ['День', 'Надходження, PLN'], rows: [['01.10', { minor: 50_000 }], ['=1+1', { minor: 12_345 }]] },
      { name: 'За категоріями', header: ['Категорія'], rows: [] },
      { name: 'Звірка', header: ['Рядок'], rows: [[], ['Розбіжність', { minor: -7 }]] },
    ])
    const files = unzipSync(bytes)
    const workbook = strFromU8(files['xl/workbook.xml'])
    for (const name of ['Звіт', 'За категоріями', 'Звірка']) expect(workbook).toContain(`name="${name}"`)
    const strings = strFromU8(files['xl/sharedStrings.xml'])
    expect(strings).toContain('Надходження, PLN')
    expect(strings).toContain('=1+1')
    const first = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(first).toContain('<v>500</v>')
    expect(first).toContain('<v>123.45</v>')
    expect(first).not.toContain('<f>')
    expect(strFromU8(files['xl/worksheets/sheet3.xml'])).toContain('<v>-0.07</v>')
  })
})
