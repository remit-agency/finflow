import { asRecord, bad, isId, onlyKeys } from './guards'
import { isDay, monthsBetween } from './days'
import { MAX_MINOR, isMinor } from './money'
import { TX_STATUSES, TX_TYPES, type Accrual, type LedgerTransaction, type TxStatus, type TxType } from './types'

export const MAX_PERIOD_MONTHS = 36
export const MIN_DAY = '2000-01-01'

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/
const RESERVED = /^__.*__$/

const CREATE_KEYS = [
  'clientId', 'type', 'status', 'accountId', 'amountMinor', 'toAccountId', 'toAmountMinor', 'paymentDate',
  'accrual', 'categoryId', 'counterpartyId', 'description', 'isRecurring', 'projectId', 'tags', 'fileUrls',
] as const
const PATCH_KEYS = CREATE_KEYS.filter((k) => k !== 'clientId')
const NULLABLE = new Set(['toAccountId', 'toAmountMinor', 'accrual', 'categoryId', 'counterpartyId', 'description', 'projectId'])

/** A validated create request (defaults filled). Amounts are minor units. */
export interface TransactionInput {
  clientId?: string
  type: TxType
  status: TxStatus
  accountId: string
  amountMinor: number
  toAccountId?: string
  toAmountMinor?: number
  paymentDate: string
  accrual: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
}

/** The editable fields of an existing operation, before defaults (input of `applyPatch`). */
export type RawInput = Record<string, unknown>

/** A partial update: a key set to null clears an optional field. */
export type TransactionPatch = Record<string, unknown>

function day(v: unknown, field: string): string {
  if (!isDay(v) || v < MIN_DAY) bad(field)
  return v
}

function amount(v: unknown, field: string): number {
  if (!isMinor(v) || v <= 0 || v > MAX_MINOR) bad(field)
  return v
}

function parseAccrual(v: unknown): Accrual {
  const r = asRecord(v, 'accrual')
  if (r.mode === 'date') {
    onlyKeys(r, ['mode', 'date'], 'accrual.')
    return { mode: 'date', date: day(r.date, 'accrual.date') }
  }
  if (r.mode === 'period') {
    onlyKeys(r, ['mode', 'from', 'to'], 'accrual.')
    const from = day(r.from, 'accrual.from')
    const to = day(r.to, 'accrual.to')
    if (from > to || monthsBetween(from, to).length > MAX_PERIOD_MONTHS) bad('accrual.to')
    return { mode: 'period', from, to }
  }
  return bad('accrual.mode')
}

function stringList(v: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > maxItems) bad(field)
  return v.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) bad(field)
    return item
  })
}

export function parseTransactionInput(body: unknown): TransactionInput {
  const r = asRecord(body)
  onlyKeys(r, CREATE_KEYS)

  if (!(TX_TYPES as readonly unknown[]).includes(r.type)) bad('type')
  const type = r.type as TxType
  const status = r.status === undefined ? 'actual' : r.status
  if (!(TX_STATUSES as readonly unknown[]).includes(status)) bad('status')

  if (r.clientId !== undefined && !(typeof r.clientId === 'string' && CLIENT_ID.test(r.clientId) && !RESERVED.test(r.clientId))) {
    bad('clientId')
  }
  if (!isId(r.accountId)) bad('accountId')
  const paymentDate = day(r.paymentDate, 'paymentDate')

  const out: TransactionInput = {
    type,
    status: status as TxStatus,
    accountId: r.accountId,
    amountMinor: amount(r.amountMinor, 'amountMinor'),
    paymentDate,
    accrual: { mode: 'date', date: paymentDate },
    isRecurring: false,
    tags: stringList(r.tags, 'tags', 20, 50),
    fileUrls: stringList(r.fileUrls, 'fileUrls', 10, 2048),
  }
  if (r.clientId !== undefined) out.clientId = r.clientId as string

  if (type === 'transfer') {
    if (!isId(r.toAccountId)) bad('toAccountId')
    out.toAccountId = r.toAccountId
    if (r.toAmountMinor !== undefined) out.toAmountMinor = amount(r.toAmountMinor, 'toAmountMinor')
    if (r.categoryId !== undefined) bad('categoryId')
    if (r.accrual !== undefined) bad('accrual')
    if (r.counterpartyId !== undefined) bad('counterpartyId')
  } else {
    if (r.toAccountId !== undefined) bad('toAccountId')
    if (r.toAmountMinor !== undefined) bad('toAmountMinor')
    if (r.accrual !== undefined) out.accrual = parseAccrual(r.accrual)
    if (r.categoryId !== undefined) {
      if (!isId(r.categoryId)) bad('categoryId')
      out.categoryId = r.categoryId
    }
    if (r.counterpartyId !== undefined) {
      if (!isId(r.counterpartyId)) bad('counterpartyId')
      out.counterpartyId = r.counterpartyId
    }
  }

  if (r.projectId !== undefined) {
    if (!isId(r.projectId)) bad('projectId')
    out.projectId = r.projectId
  }
  if (r.description !== undefined) {
    if (typeof r.description !== 'string') bad('description')
    const text = r.description.trim()
    if (text.length > 500) bad('description')
    if (text.length > 0) out.description = text
  }
  if (r.isRecurring !== undefined) {
    if (typeof r.isRecurring !== 'boolean') bad('isRecurring')
    out.isRecurring = r.isRecurring
  }
  return out
}

/** Validates the shape of a PATCH body: known keys, null only for optional fields, at least one key. */
export function parseTransactionPatch(body: unknown): TransactionPatch {
  const r = asRecord(body)
  onlyKeys(r, PATCH_KEYS)
  if (Object.keys(r).length === 0) bad('body')
  for (const [key, value] of Object.entries(r)) {
    if (value === null && !NULLABLE.has(key)) bad(key)
  }
  return r
}

/** The editable fields of an existing operation. An accrual that just follows the payment date is left out. */
export function toRawInput(tx: LedgerTransaction): RawInput {
  const raw: RawInput = {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    paymentDate: tx.paymentDate,
    isRecurring: tx.isRecurring,
    tags: tx.tags,
    fileUrls: tx.fileUrls,
  }
  if (tx.type === 'transfer') {
    raw.toAccountId = tx.toAccountId
    // Between accounts of one currency the target amount is the amount itself: leaving it out lets an
    // edit of the amount carry over. Only a cross-currency transfer has an amount of its own.
    if (tx.toCurrency !== tx.currency) raw.toAmountMinor = tx.toAmountMinor
  } else if (!(tx.accrual.mode === 'date' && tx.accrual.date === tx.paymentDate)) {
    raw.accrual = tx.accrual
  }
  if (tx.categoryId !== undefined) raw.categoryId = tx.categoryId
  if (tx.counterpartyId !== undefined) raw.counterpartyId = tx.counterpartyId
  if (tx.description !== undefined) raw.description = tx.description
  if (tx.projectId !== undefined) raw.projectId = tx.projectId
  return raw
}

/** Applies a validated patch onto the editable fields and revalidates the whole result. */
export function applyPatch(raw: RawInput, patch: TransactionPatch): TransactionInput {
  const merged: RawInput = { ...raw }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return parseTransactionInput(merged)
}
