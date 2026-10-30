import { isDay } from '@/lib/domain/ledger/days'
import { asRecord, bad, isId, onlyKeys } from '@/lib/domain/ledger/guards'
import { parseTransactionPatch } from '@/lib/domain/ledger/input'
import { tagIdsOf } from '@/lib/domain/tags/assign'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import type { BulkPatch } from './selection'

/** One request carries at most this many operations; the browser sends a larger selection in several requests. */
export const MAX_BULK_IDS = 25

export type BulkOutcome = { id: string; ok: true } | { id: string; ok: false; code: string }

export type BulkRequest = { action: 'delete'; ids: string[] } | { action: 'update'; ids: string[]; patch: BulkPatch }

const PATCH_KEYS = ['categoryId', 'counterpartyId', 'description', 'paymentDate', 'accrual', 'addTagIds', 'removeTagIds'] as const
const TAG_KEYS: readonly string[] = ['addTagIds', 'removeTagIds']

function tagIds(v: unknown, field: string): string[] {
  const ids = tagIdsOf(v, MAX_TX_TAGS)
  if (ids === null || ids.length === 0) bad(field)
  return ids
}

/** A tag change (S10t) is a bulk change of its own: the new list is computed for each operation from the tags it has. */
function tagPatch(patch: Record<string, unknown>): BulkPatch {
  if (Object.keys(patch).some((k) => !TAG_KEYS.includes(k))) bad('patch')
  const out: BulkPatch = {}
  if (patch.addTagIds !== undefined) out.addTagIds = tagIds(patch.addTagIds, 'patch.addTagIds')
  if (patch.removeTagIds !== undefined) out.removeTagIds = tagIds(patch.removeTagIds, 'patch.removeTagIds')
  if ((out.addTagIds ?? []).some((id) => (out.removeTagIds ?? []).includes(id))) bad('patch.removeTagIds')
  return out
}

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
  if (Object.keys(patch).some((k) => TAG_KEYS.includes(k))) return { action: 'update', ids: ids as string[], patch: tagPatch(patch) }
  if (patch.paymentDate !== undefined && !isDay(patch.paymentDate)) bad('patch.paymentDate')
  // The field-level rules (types, nulls, accrual shape) are the ones the single-operation PATCH enforces.
  parseTransactionPatch(patch)
  return { action: 'update', ids: ids as string[], patch: patch as BulkPatch }
}
