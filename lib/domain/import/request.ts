import { isDay } from '@/lib/domain/ledger/days'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import { IMPORT_STEP, MAX_IMPORT_OPS, type ImportOp } from './types'

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string }

const ID = /^[A-Za-z0-9_-]{1,128}$/
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
const str = (v: unknown, max: number): string | null | undefined => (v === null ? null : typeof v === 'string' && v.length <= max ? v : undefined)

export interface StepStatement {
  source: string | null
  currency: string | null
  from: string | null
  to: string | null
  closingMinor: number | null
}
export interface ImportStepRequest {
  importId?: string
  fileName: string
  accountId: string
  statement: StepStatement
  operations: ImportOp[]
  last: boolean
}

function parseOp(v: unknown, at: string): Parsed<ImportOp> {
  if (!isRecord(v)) return { ok: false, field: at }
  if (!isDay(v.day)) return { ok: false, field: `${at}.day` }
  if (v.type !== 'income' && v.type !== 'expense') return { ok: false, field: `${at}.type` }
  if (!Number.isSafeInteger(v.amountMinor) || (v.amountMinor as number) < 0 || (v.amountMinor as number) > MAX_MINOR) return { ok: false, field: `${at}.amountMinor` }
  if (!Number.isSafeInteger(v.ordinal) || (v.ordinal as number) < 0 || (v.ordinal as number) > MAX_IMPORT_OPS) return { ok: false, field: `${at}.ordinal` }
  const reference = str(v.reference, 200)
  const counterpartyName = str(v.counterpartyName, 200)
  const remittance = str(v.remittance, 500)
  if (reference === undefined) return { ok: false, field: `${at}.reference` }
  if (counterpartyName === undefined) return { ok: false, field: `${at}.counterpartyName` }
  if (remittance === undefined) return { ok: false, field: `${at}.remittance` }
  return { ok: true, value: { day: v.day, type: v.type, amountMinor: v.amountMinor as number, ordinal: v.ordinal as number, reference, counterpartyName, remittance } }
}

export function parseImportStep(body: unknown): Parsed<ImportStepRequest> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (body.importId !== undefined && !isId(body.importId)) return { ok: false, field: 'importId' }
  if (typeof body.fileName !== 'string' || body.fileName.trim() === '' || body.fileName.length > 255) return { ok: false, field: 'fileName' }
  if (!isId(body.accountId)) return { ok: false, field: 'accountId' }
  const s = body.statement
  if (!isRecord(s)) return { ok: false, field: 'statement' }
  const source = str(s.source, 64)
  const currency = s.currency === null || (typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency)) ? (s.currency as string | null) : undefined
  const from = s.from === null || isDay(s.from) ? (s.from as string | null) : undefined
  const to = s.to === null || isDay(s.to) ? (s.to as string | null) : undefined
  const closing = s.closingMinor === null || (Number.isSafeInteger(s.closingMinor) && Math.abs(s.closingMinor as number) <= MAX_MINOR) ? (s.closingMinor as number | null) : undefined
  if (source === undefined) return { ok: false, field: 'statement.source' }
  if (currency === undefined) return { ok: false, field: 'statement.currency' }
  if (from === undefined) return { ok: false, field: 'statement.from' }
  if (to === undefined) return { ok: false, field: 'statement.to' }
  if (closing === undefined) return { ok: false, field: 'statement.closingMinor' }
  if (!Array.isArray(body.operations) || body.operations.length > IMPORT_STEP) return { ok: false, field: 'operations' }
  const operations: ImportOp[] = []
  for (let i = 0; i < body.operations.length; i++) {
    const op = parseOp(body.operations[i], `operations[${i}]`)
    if (!op.ok) return op
    operations.push(op.value)
  }
  if (typeof body.last !== 'boolean') return { ok: false, field: 'last' }
  return {
    ok: true,
    value: { ...(body.importId === undefined ? {} : { importId: body.importId as string }), fileName: body.fileName.trim(), accountId: body.accountId, statement: { source, currency, from, to, closingMinor: closing }, operations, last: body.last },
  }
}

export interface PreviewRequest {
  fileName: string
  text: string
  accountIds?: Array<string | null>
}
export function parsePreviewRequest(body: unknown): Parsed<PreviewRequest> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (typeof body.fileName !== 'string' || body.fileName.trim() === '' || body.fileName.length > 255) return { ok: false, field: 'fileName' }
  if (typeof body.text !== 'string' || body.text === '') return { ok: false, field: 'text' }
  if (body.accountIds === undefined) return { ok: true, value: { fileName: body.fileName.trim(), text: body.text } }
  if (!Array.isArray(body.accountIds) || body.accountIds.length > 200 || !body.accountIds.every((a) => a === null || isId(a))) return { ok: false, field: 'accountIds' }
  return { ok: true, value: { fileName: body.fileName.trim(), text: body.text, accountIds: body.accountIds as Array<string | null> } }
}

export function parseUndoRequest(body: unknown): Parsed<{ cursor?: string }> {
  if (body === null || body === undefined) return { ok: true, value: {} }
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (body.cursor !== undefined && !isId(body.cursor)) return { ok: false, field: 'cursor' }
  return { ok: true, value: body.cursor === undefined ? {} : { cursor: body.cursor as string } }
}
