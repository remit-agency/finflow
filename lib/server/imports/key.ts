import { createHash } from 'node:crypto'
import { opIdentityParts } from '@/lib/domain/import/identity'
import type { ImportOp } from '@/lib/domain/import/types'

/** The `bankSeen` key of a file line: 32 hex characters, inside the FinFlow account, in its own namespace (`file`), recomputed on the server from the line. */
export function importKey(accountId: string, op: ImportOp): string {
  return createHash('sha256').update(['file', accountId, ...opIdentityParts(op), String(op.ordinal)].join('\u0001')).digest('hex').slice(0, 32)
}
