import { describe, expect, it } from 'vitest'
import { excelDay, minuteOf, moneyMinor, parseFinmapTable, textDay } from '@/lib/domain/import/finmap/rows'
import { MAX_FINMAP_ROWS, type ColumnKey } from '@/lib/domain/import/finmap/types'

// Plain Polish header, in the export's column order (synthetic; the owner's file is never copied).
const HEADER = [
  'Data płatności', 'Data zaksięgowania', 'Okres księgowania – data od', 'Okres księgowania – data do',
  'Kwota w walucie konta', 'Kwota w walucie firmy', 'Z konta', 'Na konto',
  'Kategoria', 'Podkategoria', 'Kontrahent', 'Podkontrahent', 'Projekt', 'Podprojekt', 'Tagi', 'Komentarz',
]
const COLS: ColumnKey[] = [
  'paymentDate', 'bookingDate', 'periodFrom', 'periodTo', 'amountAccount', 'amountCompany', 'from', 'to',
  'category', 'subcategory', 'counterparty', 'subcounterparty', 'project', 'subproject', 'tags', 'comment',
]

/** Builds one table row from named cells; the others are empty. */
function cells(values: Partial<Record<ColumnKey, string>>): string[] {
  return COLS.map((k) => values[k] ?? '')
}

const EPOCH = Date.UTC(1899, 11, 30)
const dayOfSerial = (n: number) => new Date(EPOCH + n * 86400000).toISOString().slice(0, 10)

describe('excelDay', () => {
  it('converts an Excel serial to a day, independently of the time part', () => {
    const serial = 46346.959814814814
    expect(excelDay(serial)).toBe(dayOfSerial(Math.floor(serial)))
  })

  it('rejects serials out of the Excel range', () => {
    expect(excelDay(0)).toBeNull()
    expect(excelDay(2958466)).toBeNull()
  })
})

describe('minuteOf', () => {
  it('gives the minutes since midnight of the time part', () => {
    const serial = 46346.959814814814
    const frac = serial - Math.floor(serial)
    expect(minuteOf(serial)).toBe(Math.floor(frac * 1440))
  })

  it('is 0 for a serial without a time', () => {
    expect(minuteOf(46346)).toBe(0)
  })
})

describe('textDay', () => {
  it('reads dd.mm.yyyy with or without a time', () => {
    expect(textDay('16.11.2026')).toBe('2026-11-16')
    expect(textDay('16.11.2026 13:45:00')).toBe('2026-11-16')
  })

  it('reads yyyy-mm-dd', () => {
    expect(textDay('2026-11-16')).toBe('2026-11-16')
  })

  it('rejects a day that does not exist', () => {
    expect(textDay('31.02.2026')).toBeNull()
  })

  it('rejects other text', () => {
    expect(textDay('nie')).toBeNull()
  })
})

describe('moneyMinor', () => {
  it('reads a decimal with up to two places as minor units', () => {
    expect(moneyMinor('22721.08')).toBe(2272108)
    expect(moneyMinor('12.3')).toBe(1230)
  })

  it('reads a whole number', () => {
    expect(moneyMinor('4000')).toBe(400000)
  })

  it('refuses more than two decimals, empty text and negatives', () => {
    expect(moneyMinor('12.345')).toBeNull()
    expect(moneyMinor('')).toBeNull()
    expect(moneyMinor('-5')).toBeNull()
  })
})

describe('parseFinmapTable', () => {
  it('reads a row: day and minute from the serial, amount, names', () => {
    const serial = '46346.959814814814'
    const table = [HEADER, cells({ paymentDate: serial, amountAccount: '22721.08', from: '  Konto  A ', to: 'Konto B', category: 'Kategorie wydatków' })]
    const { rows, issues } = parseFinmapTable(table)
    expect(issues).toEqual([])
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.line).toBe(2)
    expect(r.paymentDay).toBe(dayOfSerial(46346))
    expect(r.timeText).toBe(serial)
    expect(r.minute).toBe(Math.floor((46346.959814814814 - 46346) * 1440))
    expect(r.amountMinor).toBe(2272108)
    expect(r.from).toBe('Konto A')
    expect(r.to).toBe('Konto B')
    expect(r.category).toBe('Kategorie wydatków')
    expect(r.subcategory).toBeNull()
  })

  it('reads a text payment date with a time', () => {
    const { rows } = parseFinmapTable([HEADER, cells({ paymentDate: '16.11.2026 13:45:00', amountAccount: '1', from: 'A', to: 'B' })])
    expect(rows[0].paymentDay).toBe('2026-11-16')
    expect(rows[0].minute).toBe(13 * 60 + 45)
  })

  it('gives a null day for a payment date that is neither a serial nor a day', () => {
    const { rows } = parseFinmapTable([HEADER, cells({ paymentDate: 'x', amountAccount: '1', from: 'A', to: 'B' })])
    expect(rows[0].paymentDay).toBeNull()
  })

  it('keeps the line number of the sheet: empty rows are skipped but counted in line numbers', () => {
    const row = cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B' })
    const { rows } = parseFinmapTable([HEADER, row, cells({}), row])
    expect(rows.map((r) => r.line)).toEqual([2, 4])
  })

  it('reads tags split on comma and semicolon, without empties and duplicates', () => {
    const { rows } = parseFinmapTable([HEADER, cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', tags: 'ATM, Do zwrotu;ATM' })])
    expect(rows[0].tags).toEqual(['ATM', 'Do zwrotu'])
  })

  it('reads the period only when both ends are readable', () => {
    const both = parseFinmapTable([HEADER, cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', periodFrom: '01.11.2026', periodTo: '30.11.2026' })])
    expect(both.rows[0].period).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    const one = parseFinmapTable([HEADER, cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', periodFrom: '01.11.2026' })])
    expect(one.rows[0].period).toBeNull()
  })

  it('flags a subcounterparty, a project or a subproject only when non-empty', () => {
    const { rows } = parseFinmapTable([
      HEADER,
      cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', subcounterparty: ' ', project: 'P' }),
      cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', subcounterparty: 'S' }),
    ])
    expect(rows[0].hasSubcounterparty).toBe(false)
    expect(rows[0].hasProject).toBe(true)
    expect(rows[1].hasSubcounterparty).toBe(true)
    expect(rows[1].hasProject).toBe(false)
  })

  it('collapses whitespace in a comment and does not cut it', () => {
    const { rows } = parseFinmapTable([HEADER, cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B', comment: 'a\n  b' })])
    expect(rows[0].comment).toBe('a b')
  })

  it('returns empty when the table has a header only', () => {
    expect(parseFinmapTable([HEADER])).toEqual({ rows: [], issues: [{ code: 'empty' }] })
  })

  it('returns unknown_layout with the missing columns for a foreign header', () => {
    const { rows, issues } = parseFinmapTable([['Foo', 'Bar'], ['1', '2']])
    expect(rows).toEqual([])
    expect(issues).toEqual([{ code: 'unknown_layout', missing: ['paymentDate', 'amountAccount', 'from', 'to'] }])
  })

  it('refuses a table over the row limit, and does not count empty rows', () => {
    const row = cells({ paymentDate: '46346', amountAccount: '1', from: 'A', to: 'B' })
    const over = Array.from({ length: MAX_FINMAP_ROWS + 1 }, () => row)
    expect(parseFinmapTable([HEADER, ...over])).toEqual({ rows: [], issues: [{ code: 'too_many_rows' }] })
    const atLimit = Array.from({ length: MAX_FINMAP_ROWS }, () => row)
    const empties = Array.from({ length: 5 }, () => cells({}))
    const { rows, issues } = parseFinmapTable([HEADER, ...atLimit, ...empties])
    expect(issues).toEqual([])
    expect(rows).toHaveLength(MAX_FINMAP_ROWS)
  })
})
