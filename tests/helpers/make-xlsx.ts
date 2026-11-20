import { strToU8, zipSync } from 'fflate'

/** A cell of a test sheet: text, a number (written as a number), or null (no cell). */
export type Cell = string | number | null

export interface SheetSpec {
  name: string
  rows: Cell[][]
}

export interface XlsxOptions {
  /** Write text as shared strings (`t="s"`) instead of inline strings. */
  shared?: boolean
}

const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const CT_SHARED = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Column letters for a 0-based index: 0 is A, 26 is AA. */
export function colName(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Zips the given parts (path → XML text) into an xlsx-shaped file. Used directly by tests that need unusual XML. */
export function zipXlsx(files: Record<string, string>): Uint8Array {
  const parts: Record<string, Uint8Array> = {}
  for (const name of Object.keys(files)) parts[name] = strToU8(files[name])
  return zipSync(parts)
}

/** A minimal workbook with one worksheet per spec, in the given order. */
export function makeXlsxBook(sheets: SheetSpec[], opts: XlsxOptions = {}): Uint8Array {
  const shared: string[] = []
  const sharedIndex = new Map<string, number>()
  const sharedRef = (s: string): number => {
    let i = sharedIndex.get(s)
    if (i === undefined) {
      i = shared.length
      shared.push(s)
      sharedIndex.set(s, i)
    }
    return i
  }

  const files: Record<string, string> = {}
  const sheetEntries: string[] = []
  const relEntries: string[] = []
  const overrides: string[] = []

  sheets.forEach((sheet, k) => {
    const n = k + 1
    const rows = sheet.rows.map((cells, i) => {
      const cs: string[] = []
      cells.forEach((cell, j) => {
        if (cell === null) return
        const ref = `${colName(j)}${i + 1}`
        if (typeof cell === 'number') {
          cs.push(`<c r="${ref}"><v>${String(cell)}</v></c>`)
        } else if (opts.shared) {
          cs.push(`<c r="${ref}" t="s"><v>${sharedRef(cell)}</v></c>`)
        } else {
          cs.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`)
        }
      })
      return `<row r="${i + 1}">${cs.join('')}</row>`
    })
    files[`xl/worksheets/sheet${n}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${SHEET_NS}"><sheetData>${rows.join('')}</sheetData></worksheet>`
    sheetEntries.push(`<sheet name="${esc(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`)
    relEntries.push(`<Relationship Id="rId${n}" Type="${RELS_NS}/worksheet" Target="worksheets/sheet${n}.xml"/>`)
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${CT_SHEET}"/>`)
  })

  if (opts.shared) {
    const si = shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')
    files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${SHEET_NS}" count="${shared.length}" uniqueCount="${shared.length}">${si}</sst>`
    relEntries.push(`<Relationship Id="rId${sheets.length + 1}" Type="${RELS_NS}/sharedStrings" Target="sharedStrings.xml"/>`)
    overrides.push(`<Override PartName="/xl/sharedStrings.xml" ContentType="${CT_SHARED}"/>`)
  }

  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join('')}</Types>`
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${SHEET_NS}" xmlns:r="${RELS_NS}"><sheets>${sheetEntries.join('')}</sheets></workbook>`
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries.join('')}</Relationships>`

  return zipXlsx(files)
}

/** A workbook with one worksheet. */
export function makeXlsx(rows: Cell[][], opts: XlsxOptions & { sheetName?: string } = {}): Uint8Array {
  return makeXlsxBook([{ name: opts.sheetName ?? 'Sheet1', rows }], opts)
}
