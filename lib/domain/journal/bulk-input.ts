import { isDay } from '@/lib/domain/ledger/days'
import { asRecord, bad, isId, onlyKeys } from '@/lib/domain/ledger/guards'
import { parseTransactionPatch } from '@/lib/domain/ledger/input'
import type { BulkPatch } from './selection'

/** One request carries at most this many operations; the browser sends a larger selection in several requests. */
export const MAX_BULK_IDS = 25

export type BulkRequest = { action: 'delete'; ids: string[] } | { action: 'update'; ids: string[]; patch: BulkPatch }

const PATCH_KEYS = ['categoryId', 'counterpartyId', 'description', 'paymentDate', 'accrual'] as const

export function parseBulkRequest(body: unknown): BulkRequest {
  const r = asRecord(body)
  onlyKeys(r, ['action', 'ids', 'patch'])
  const ids = r.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK_IDS) bad('ids')
  if (!ids.every((id) => isId(id)) || new Set(ids).size !== ids.length) bad('ids')

  if (r.action === 'delete') {
    if (r.patch !== undefined) bad('patch')
    return { action: 'delete', ids: ids as string[] }
  }
  if (r.action !== 'update') bad('action')

  const patch = asRecord(r.patch, 'patch')
  onlyKeys(patch, PATCH_KEYS, 'patch.')
  if (Object.keys(patch).length === 0) bad('patch')
  if (patch.paymentDate !== undefined && !isDay(patch.paymentDate)) bad('patch.paymentDate')
  // The field-level rules (types, nulls, accrual shape) are the ones the single-operation PATCH enforces.
  parseTransactionPatch(patch)
  return { action: 'update', ids: ids as string[], patch: patch as BulkPatch }
}
