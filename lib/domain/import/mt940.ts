import { isDay } from '@/lib/domain/ledger/days'
import { withOrdinals } from './identity'
import type { ParseIssue, ParseResult, ParsedStatement, RawOp, StatementBalance } from './types'

interface Rec {
  tag: string
  line: number
  lines: string[]
}

const TAG = /^:(\d{2}[A-Z]?):(.*)$/
/** `:61:` value day, optional entry day (mmdd), D/C/RD/RC, optional funds code, amount, `N`+type, customer ref, `//bank ref`. */
const L61 = /^(\d{6})(\d{4})?(RC|RD|C|D)[A-Z]?(\d{1,12}(?:,\d{0,2})?)[NFS]([A-Z0-9]{3})(.*?)(?:\/\/(.*))?$/
const BALANCE = /^([CD])(\d{6})([A-Z]{3})(\d{1,12}(?:,\d{0,2})?)$/
/** The Polish dialects of `:86:`: a three digit code, then `~NN` or `?NN` sub-fields. */
const STRUCTURED = /^(?:\d{3})?[~?]\d{2}/
/** Sub-fields that hold the payment title, and those that hold the other party's name (Polish ZBP format). */
const TITLE_FIELDS = ['20', '21', '22', '23', '24', '25', '60', '61', '62', '63'] as const
const NAME_FIELDS = ['32', '33'] as const

/** "1000,50" -> 100050; "1000," and "1000" are whole units. Null for anything else. */
function minorOf(raw: string): number | null {
  const m = /^(\d{1,12})(?:,(\d{0,2}))?$/.exec(raw)
  if (m === null) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** yymmdd -> YYYY-MM-DD (years 2000-2099); null when it is not a real day. */
function dayOf(yymmdd: string): string | null {
  const day = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
  return isDay(day) ? day : null
}

function balanceOf(text: string): StatementBalance | null {
  const m = BALANCE.exec(text.trim())
  if (m === null) return null
  const day = dayOf(m[2])
  const minor = minorOf(m[4])
  if (day === null || minor === null) return null
  return { amountMinor: m[1] === 'D' && minor !== 0 ? -minor : minor, day, currency: m[3] }
}

/** The entry day mmdd takes the value day's year, moved by one when the two straddle a year end. */
function entryDay(valueDay: string, mmdd: string): string | null {
  const vy = Number(valueDay.slice(0, 4))
  const vm = Number(valueDay.slice(5, 7))
  const diff = Number(mmdd.slice(0, 2)) - vm
  const year = diff > 6 ? vy - 1 : diff < -6 ? vy + 1 : vy
  const day = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`
  return isDay(day) ? day : null
}

/** `:25:` as an identity: no spaces, no leading slash, upper case; an NRB (26 digits) gets the `PL` prefix. */
export function normalizeSource(raw: string): string {
  const flat = raw.replace(/\s+/g, '').replace(/^\//, '').toUpperCase().replace(/\//g, '')
  return /^\d{26}$/.test(flat) ? `PL${flat}` : flat
}

function clean(s: string): string | null {
  const t = s.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** The `:86:` text of a line: the name and the title when the dialect is a Polish one, else the whole text as the title. */
function narrative(lines: readonly string[]): { counterpartyName: string | null; remittance: string | null } {
  if (lines.length === 0) return { counterpartyName: null, remittance: null }
  if (!STRUCTURED.test(lines[0].trim())) return { counterpartyName: null, remittance: clean(lines.join(' ')) }
  // Sub-fields are cut at fixed widths, so a line break may fall inside one: the lines are joined without a separator.
  const parts = lines.join('').split(/[~?](\d{2})/)
  const fields = new Map<string, string>()
  for (let i = 1; i + 1 < parts.length; i += 2) fields.set(parts[i], `${fields.get(parts[i]) ?? ''}${parts[i + 1]}`)
  const join = (codes: readonly string[]) => clean(codes.map((c) => fields.get(c)?.trim() ?? '').filter((s) => s !== '').join(' '))
  return { counterpartyName: join(NAME_FIELDS), remittance: join(TITLE_FIELDS) ?? clean(fields.get('00') ?? '') }
}

function toRecords(text: string): { recs: Rec[]; firstLine: number } {
  let src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  let base = 0
  const body = src.indexOf('{4:')
  if (src.trimStart().startsWith('{1:') && body >= 0) {
    base = src.slice(0, body + 3).split('\n').length - 1
    src = src.slice(body + 3)
  }
  const recs: Rec[] = []
  let cur: Rec | null = null
  src.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const lineNo = base + i + 1
    if (line === '-}' || line === '-' || line === '}') {
      cur = null
      return
    }
    const m = TAG.exec(line)
    if (m !== null) {
      cur = { tag: m[1], line: lineNo, lines: [m[2]] }
      recs.push(cur)
    } else if (cur !== null && line !== '') {
      cur.lines.push(line)
    }
  })
  return { recs, firstLine: base + 1 }
}

function parse61(rec: Rec): RawOp | null {
  const m = L61.exec(rec.lines[0].trim())
  if (m === null) return null
  const valueDay = dayOf(m[1])
  const minor = minorOf(m[4])
  if (valueDay === null || minor === null) return null
  const day = (m[2] !== undefined ? entryDay(valueDay, m[2]) : null) ?? valueDay
  const bank = clean(m[7] ?? '')
  const customer = clean(m[6])
  return {
    day,
    type: m[3] === 'C' || m[3] === 'RD' ? 'income' : 'expense',
    amountMinor: minor,
    reference: bank ?? (customer !== null && customer.toUpperCase() !== 'NONREF' ? customer : null),
    counterpartyName: null,
    remittance: null,
  }
}

interface Draft {
  source: string | null
  number: string | null
  opening: StatementBalance | null
  closing: StatementBalance | null
  ops: RawOp[]
}

function finish(d: Draft, index: number): ParsedStatement {
  const signed = d.ops.reduce((sum, o) => sum + (o.type === 'income' ? o.amountMinor : -o.amountMinor), 0)
  return {
    index,
    source: d.source,
    number: d.number,
    currency: d.opening?.currency ?? d.closing?.currency ?? null,
    opening: d.opening,
    closing: d.closing,
    operations: withOrdinals(d.ops),
    reconciliation: d.opening !== null && d.closing !== null ? d.opening.amountMinor + signed - d.closing.amountMinor : null,
  }
}

/**
 * Reads an MT940 file: statements start at `:20:` (or at the first tag when a file has no `:20:`), a `:86:` belongs to the
 * `:61:` before it. A line that cannot be read becomes an issue with its line number and the rest of the statement is kept.
 * Pure: no I/O, no clock. Byte decoding is `decodeStatementBytes`.
 */
export function parseMt940(text: string): ParseResult {
  const { recs, firstLine } = toRecords(text)
  const issues: ParseIssue[] = []
  const statements: ParsedStatement[] = []
  let draft: Draft | null = null
  let pending: RawOp | null = null
  let afterClosing = false

  const close = () => {
    if (draft !== null) statements.push(finish(draft, statements.length))
    draft = null
    pending = null
    afterClosing = false
  }
  const open = (): Draft => {
    draft = { source: null, number: null, opening: null, closing: null, ops: [] }
    return draft
  }

  for (const rec of recs) {
    if (rec.tag === '20') {
      close()
      open()
      continue
    }
    const d = draft ?? open()
    const first = rec.lines[0].trim()
    switch (rec.tag) {
      case '25':
        d.source = normalizeSource(first)
        break
      case '28C':
        d.number = clean(first)
        break
      case '60F':
      case '60M': {
        const b = balanceOf(first)
        if (b === null) issues.push({ code: 'bad_balance', line: rec.line, tag: rec.tag })
        else d.opening ??= b
        break
      }
      case '62F':
      case '62M': {
        const b = balanceOf(first)
        if (b === null) issues.push({ code: 'bad_balance', line: rec.line, tag: rec.tag })
        else if (rec.tag === '62F' || d.closing === null) d.closing = b
        pending = null
        afterClosing = true
        break
      }
      case '61': {
        const op = parse61(rec)
        if (op === null) {
          issues.push({ code: 'bad_61', line: rec.line, tag: '61' })
          pending = null
        } else {
          d.ops.push(op)
          pending = op
        }
        break
      }
      case '86': {
        if (pending !== null) {
          Object.assign(pending, narrative(rec.lines))
          pending = null
        } else if (!afterClosing && d.ops.length === 0) {
          issues.push({ code: 'orphan_86', line: rec.line, tag: '86' })
        }
        break
      }
      default:
        break
    }
  }
  close()
  if (statements.length === 0) issues.push({ code: 'no_statement', line: firstLine })
  return { statements, issues }
}
