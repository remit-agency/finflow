import { unzipSync } from 'fflate'
import { foldHeader } from './fold'

/** Excel's row limit: a larger `r` attribute is not a sheet this reader will expand. */
const MAX_SHEET_ROW = 1048576
/** Excel's last column (XFD) is index 16383. */
const MAX_COLUMN = 16383

const WORKBOOK = 'xl/workbook.xml'
const RELS = 'xl/_rels/workbook.xml.rels'
const SHARED = 'xl/sharedStrings.xml'
const META = new Set([WORKBOOK, RELS, SHARED])

const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const RICH_PHONETIC = /<rPh\b[^>]*?(?:\/>|>[\s\S]*?<\/rPh>)/g
const RICH_TEXT = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g
const SHEET_ITEM = /<sheet\b([^>]*?)\/?>/g
const REL_ITEM = /<Relationship\b([^>]*?)\/?>/g
const SI = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g
const ROW = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
const CELL_REF = /\br="([^"]*)"/
const CELL_TYPE = /\bt="([^"]*)"/
const INLINE = /<is\b[^>]*?>([\s\S]*?)<\/is>/
const VALUE = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/

function fail(): never {
  throw new Error('xlsx')
}

function unescapeXml(s: string): string {
  if (s.indexOf('&') === -1) return s
  return s.replace(ENTITY, (_, e: string) => {
    switch (e) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    }
  })
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(ATTR)) out[m[1]] = unescapeXml(m[2] ?? m[3] ?? '')
  return out
}

/** The plain text of a rich-text body (`<si>` or `<is>`): its `<t>` runs, phonetic runs left out. */
function richText(xml: string): string {
  const plain = xml.indexOf('<rPh') === -1 ? xml : xml.replace(RICH_PHONETIC, '')
  let out = ''
  for (const m of plain.matchAll(RICH_TEXT)) out += unescapeXml(m[1] ?? '')
  return out
}

function sharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(SI)) out.push(richText(m[1] ?? ''))
  return out
}

/** Column index of a cell reference such as `B3` (A is 0). */
function columnOf(ref: string): number {
  const letters = /^([A-Z]{1,3})\d+$/.exec(ref)
  if (letters === null) fail()
  let n = 0
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  if (n - 1 > MAX_COLUMN) fail()
  return n - 1
}

function cellText(type: string | undefined, body: string, shared: string[]): string {
  if (type === 'inlineStr') {
    const is = INLINE.exec(body)
    return is === null ? '' : richText(is[1])
  }
  const v = VALUE.exec(body)
  const raw = v === null ? '' : (v[1] ?? '')
  if (type === 's') {
    if (!/^\d+$/.test(raw)) fail()
    const s = shared[Number(raw)]
    return s === undefined ? fail() : s
  }
  return unescapeXml(raw)
}

/** The rows of a worksheet. Rows keep their sheet numbers: a jump in `r` inserts empty rows. */
function sheetRows(xml: string, shared: string[]): string[][] {
  const table: string[][] = []
  for (const rm of xml.matchAll(ROW)) {
    const r = attrs(rm[1]).r
    const line = r === undefined ? table.length + 1 : Number(r)
    if (!Number.isInteger(line) || line < 1 || line > MAX_SHEET_ROW || line <= table.length) fail()
    while (table.length < line - 1) table.push([])
    const cells: string[] = []
    for (const cm of (rm[2] ?? '').matchAll(CELL)) {
      const ref = CELL_REF.exec(cm[1])
      const type = CELL_TYPE.exec(cm[1])
      const idx = ref === null ? cells.length : columnOf(ref[1])
      while (cells.length < idx) cells.push('')
      cells[idx] = cellText(type === null ? undefined : type[1], cm[2] ?? '', shared)
    }
    table.push(cells)
  }
  return table
}

function need(files: Record<string, Uint8Array>, name: string): string {
  const bytes = files[name]
  if (bytes === undefined) fail()
  return new TextDecoder().decode(bytes)
}

/**
 * Reads the table of an xlsx workbook: the sheet whose name contains "export" (else the first sheet), as text cells.
 * Only the workbook metadata and the chosen sheet are inflated. Throws `Error('xlsx')` for anything else.
 */
export function readXlsxTable(bytes: Uint8Array): string[][] {
  try {
    const meta = unzipSync(bytes, { filter: (f) => META.has(f.name) })
    const workbook = need(meta, WORKBOOK)
    const sheets = [...workbook.matchAll(SHEET_ITEM)].map((m) => attrs(m[1]))
    if (sheets.length === 0) fail()
    const rels = new Map<string, string>()
    for (const m of need(meta, RELS).matchAll(REL_ITEM)) {
      const a = attrs(m[1])
      if (a.Id !== undefined && a.Target !== undefined) rels.set(a.Id, a.Target)
    }
    const chosen = sheets.find((s) => foldHeader(s.name ?? '').includes('export')) ?? sheets[0]
    const target = rels.get(chosen['r:id'] ?? '')
    if (target === undefined) fail()
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const sheet = unzipSync(bytes, { filter: (f) => f.name === path })[path]
    if (sheet === undefined) fail()
    const shared = meta[SHARED] === undefined ? [] : sharedStrings(need(meta, SHARED))
    return sheetRows(new TextDecoder().decode(sheet), shared)
  } catch {
    throw new Error('xlsx')
  }
}
