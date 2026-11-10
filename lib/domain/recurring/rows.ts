import { isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION } from '@/lib/domain/ledger/doc'
import { isId } from '@/lib/domain/ledger/guards'
import { isMinor } from '@/lib/domain/ledger/money'
import { TX_TYPES, type TxStatus, type TxType } from '@/lib/domain/ledger/types'
import type { PlannedRow } from './types'

/** The fields the overview and the plan side of the suggestions select (Firestore bills the document anyway; the answer stays small). */
export const ROW_FIELDS = [
  'schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'seriesId', 'occurrence', 'estimated', 'manual',
  'categoryId', 'counterpartyId', 'description',
] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A selected planned operation, or null when it is not a readable planned v2 operation. The one reader of that selection. */
export function parsePlannedRow(id: string, data: unknown): PlannedRow | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION || data.status !== 'planned') return null
  const { type, accountId, amountMinor, currency, paymentDate } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type)) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string' || !isDay(paymentDate)) return null
  const row: PlannedRow = {
    id, type: type as TxType, accountId, amountMinor, currency, paymentDate, estimated: data.estimated === true, manual: data.manual === true,
  }
  if (isId(data.seriesId) && isDay(data.occurrence)) {
    row.seriesId = data.seriesId
    row.occurrence = data.occurrence
  }
  for (const key of ['categoryId', 'counterpartyId', 'description'] as const) {
    const value = data[key]
    if (typeof value === 'string') row[key] = value
  }
  return row
}

/** «Прострочено» (S11): a planned operation whose payment day is before today. Balances and reports still leave it out. */
export function isOverdue(op: { status: TxStatus; paymentDate: string }, today: string): boolean {
  return op.status === 'planned' && op.paymentDate < today
}
