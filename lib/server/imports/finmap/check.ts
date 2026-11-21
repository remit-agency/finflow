import 'server-only'
import type { FinmapCheckOp } from '@/lib/domain/import/finmap/request'
import { seenKeysOf } from '../bank-ops'
import type { ImportDeps } from '../deps'
import { finmapKey } from './key'

/**
 * Whether each operation was already written by a Finmap import (S14b): its key's mark exists. Read-only, so a page of the
 * file can be checked before anything is written; the batch writer checks the marks again inside its transactions.
 */
export async function finmapCheck(deps: ImportDeps, orgId: string, operations: readonly FinmapCheckOp[]): Promise<{ seen: boolean[] }> {
  const keys = operations.map((op) => finmapKey(op.accountId, op.toAccountId, op.identity, op.ordinal))
  const seen = await seenKeysOf(deps.db, orgId, keys)
  return { seen: keys.map((key) => seen.has(key)) }
}
