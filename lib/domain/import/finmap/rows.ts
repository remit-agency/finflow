import { isDay } from '@/lib/domain/ledger/days'
import { matchColumns, type ColumnMap } from './columns'
import { normKey, normName } from './fold'
import { MAX_FINMAP_ROWS, type ColumnKey, type FinmapRow, type TableIssue } from './types'

const EXCEL_MAX_SERIAL = 2958465
const SERIAL = /^\d+(\.\d+)?$/
const MONEY = /^-?\d+(\.\d{1,2})?$/
const TEXT_DMY = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2})(?::\d{2})?)?$/
const TEXT_ISO = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::\d{2})?)?$/

/** An Excel date serial as a day (YYYY-MM-DD); null outside Excel's range. */
export function excelDay(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > EXCEL_MAX_SERIAL) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10)
}

/** Minutes since midnight of the time part of an Excel serial (0 without a time). */
export function minuteOf(serial: number): number {
  return Math.min(1439, Math.floor(Math.round((serial - Math.floor(serial)) * 86400) / 60))
}

/** `dd.mm.yyyy[ hh:mm[:ss]]` or `yyyy-mm-dd[ hh:mm[:ss]]` as a day and minute; null when it is neither or not a real date and time. */
function parseText(s: string): { day: string; minute: number } | null {
  const t = s.trim()
  const dmy = TEXT_DMY.exec(t)
  const m = dmy ?? TEXT_ISO.exec(t)
  if (m === null) return null
  const day = dmy ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`
  if (!isDay(day)) return null
  const hasTime = m[4] !== undefined
  const hh = hasTime ? Number(m[4]) : 0
  const mm = hasTime ? Number(m[5]) : 0
  if (hh > 23 || mm > 59) return null
  return { day, minute: hh * 60 + mm }
}

/** A text date as a day (YYYY-MM-DD); null when it is not a real day. */
export function textDay(s: string): string | null {
  return parseText(s)?.day ?? null
}

/** «Kwota» text as minor units (two decimals). Null for anything else, including negatives. */
export function moneyMinor(s: string): number | null {
  const t = s.trim()
  if (!MONEY.test(t) || t.startsWith('-')) return null
  const [whole, frac = ''] = t.split('.')
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return Number.isSafeInteger(minor) ? minor : null
}

/** The payment date cell: an Excel serial (with its time) or text. */
function readWhen(raw: string): { day: string | null; minute: number } {
  const t = raw.trim()
  if (SERIAL.test(t)) {
    const n = Number(t)
    return { day: excelDay(n), minute: minuteOf(n) }
  }
  const p = parseText(t)
  return p ? { day: p.day, minute: p.minute } : { day: null, minute: 0 }
}

function toRow(cells: readonly string[], line: number, map: ColumnMap): FinmapRow {
  const at = (key: ColumnKey): string => {
    const j = map[key]
    return j === undefined ? '' : (cells[j] ?? '')
  }
  const timeText = at('paymentDate')
  const when = readWhen(timeText)
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of at('tags').split(/[,;]/)) {
    const name = normName(part)
    if (name === null || seen.has(normKey(name))) continue
    seen.add(normKey(name))
    tags.push(name)
  }
  const periodFrom = textDay(at('periodFrom'))
  const periodTo = textDay(at('periodTo'))
  return {
    line,
    paymentDay: when.day,
    timeText,
    minute: when.minute,
    amountMinor: moneyMinor(at('amountAccount')),
    from: normName(at('from')),
    to: normName(at('to')),
    category: normName(at('category')),
    subcategory: normName(at('subcategory')),
    counterparty: normName(at('counterparty')),
    hasSubcounterparty: normName(at('subcounterparty')) !== null,
    hasProject: normName(at('project')) !== null || normName(at('subproject')) !== null,
    tags,
    comment: normName(at('comment')),
    period: periodFrom !== null && periodTo !== null ? { from: periodFrom, to: periodTo } : null,
  }
}

/**
 * Reads the Finmap table: `table[0]` is the header, the data rows follow. A row with only empty cells is skipped.
 * `line` is the 1-based sheet row (the caller keeps empty sheet rows in `table`, so the numbers match Excel).
 */
export function parseFinmapTable(table: string[][]): { rows: FinmapRow[]; issues: TableIssue[] } {
  if (table.length === 0) return { rows: [], issues: [{ code: 'empty' }] }
  const { map, missing } = matchColumns(table[0])
  if (missing.length > 0) return { rows: [], issues: [{ code: 'unknown_layout', missing }] }
  const body: number[] = []
  for (let i = 1; i < table.length; i++) {
    if (table[i].some((c) => (c ?? '').trim() !== '')) body.push(i)
  }
  if (body.length === 0) return { rows: [], issues: [{ code: 'empty' }] }
  if (body.length > MAX_FINMAP_ROWS) return { rows: [], issues: [{ code: 'too_many_rows' }] }
  return { rows: body.map((i) => toRow(table[i], i + 1, map)), issues: [] }
}
