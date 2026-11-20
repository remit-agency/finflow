import { describe, expect, it } from 'vitest'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import { makeXlsx, makeXlsxBook, zipXlsx } from '@/tests/helpers/make-xlsx'

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** A workbook from raw sheet XML: the first sheet is listed first. */
function rawBook(sheets: Array<{ name: string; xml: string }>, sharedXml?: string) {
  const files: Record<string, string> = {}
  const entries: string[] = []
  const rels: string[] = []
  sheets.forEach((s, k) => {
    const n = k + 1
    files[`xl/worksheets/sheet${n}.xml`] = `${HEAD}<worksheet xmlns="${SHEET_NS}"><sheetData>${s.xml}</sheetData></worksheet>`
    entries.push(`<sheet name="${s.name}" sheetId="${n}" r:id="rId${n}"/>`)
    rels.push(`<Relationship Id="rId${n}" Type="${RELS_NS}/worksheet" Target="worksheets/sheet${n}.xml"/>`)
  })
  if (sharedXml !== undefined) files['xl/sharedStrings.xml'] = sharedXml
  files['xl/workbook.xml'] = `${HEAD}<workbook xmlns="${SHEET_NS}" xmlns:r="${RELS_NS}"><sheets>${entries.join('')}</sheets></workbook>`
  files['xl/_rels/workbook.xml.rels'] = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
  return zipXlsx(files)
}

describe('readXlsxTable', () => {
  const rows = [
    ['Data płatności', 'Kwota w walucie konta'],
    ['46346.5', '4000'],
    ['x', null, 'z'],
  ]
  const expected = [
    ['Data płatności', 'Kwota w walucie konta'],
    ['46346.5', '4000'],
    ['x', '', 'z'],
  ]

  it('round-trips inline strings, numbers and a sparse row', () => {
    expect(readXlsxTable(makeXlsx(rows))).toEqual(expected)
  })

  it('round-trips shared strings', () => {
    expect(readXlsxTable(makeXlsx(rows, { shared: true }))).toEqual(expected)
  })

  it('keeps ampersands, angle brackets, quotes and line breaks of a cell', () => {
    const text = 'R&D <x> "q"\nline two'
    expect(readXlsxTable(makeXlsx([[text]]))).toEqual([[text]])
    expect(readXlsxTable(makeXlsx([[text]], { shared: true }))).toEqual([[text]])
  })

  it('reads a rich-text shared string as its plain text, without phonetic runs', () => {
    const sst = `${HEAD}<sst xmlns="${SHEET_NS}"><si><r><t>foo</t></r><r><rPr><b/></rPr><t xml:space="preserve"> bar</t></r></si><si><rPh sb="0" eb="1"><t>KANA</t></rPh><t>baz</t></si></sst>`
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    expect(readXlsxTable(rawBook([{ name: 'ExportPL', xml: sheet }], sst))).toEqual([['foo bar', 'baz']])
  })

  it('chooses the sheet whose name contains "export", even when it is not first', () => {
    const bytes = makeXlsxBook([
      { name: 'Summary', rows: [['S']] },
      { name: 'ExportPL', rows: [['E']] },
    ])
    expect(readXlsxTable(bytes)).toEqual([['E']])
  })

  it('takes the first sheet when no name contains "export"', () => {
    const bytes = makeXlsxBook([
      { name: 'Summary', rows: [['S']] },
      { name: 'Other', rows: [['O']] },
    ])
    expect(readXlsxTable(bytes)).toEqual([['S']])
  })

  it('inserts empty rows where the row numbers jump, so the table index is the sheet row', () => {
    const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>x</t></is></c></row>'
    expect(readXlsxTable(rawBook([{ name: 'ExportPL', xml: sheet }]))).toEqual([['a'], [], ['', 'x']])
  })

  it('refuses a row number beyond Excel\'s row limit', () => {
    const sheet = '<row r="2000000"><c r="A1"><v>1</v></c></row>'
    expect(() => readXlsxTable(rawBook([{ name: 'ExportPL', xml: sheet }]))).toThrow('xlsx')
  })

  it('throws for bytes that are not a zip file', () => {
    expect(() => readXlsxTable(Uint8Array.from([1, 2, 3]))).toThrow('xlsx')
  })

  it('throws for a zip file without a workbook', () => {
    expect(() => readXlsxTable(zipXlsx({ 'readme.txt': 'not a workbook' }))).toThrow('xlsx')
  })
})
