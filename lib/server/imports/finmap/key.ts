import { createHash } from 'node:crypto'

/**
 * The `bankSeen` key of a Finmap operation (S14b): its own namespace (`finmap`), the FinFlow account id, the target account id
 * (transfers), the identity strings the client sends and the ordinal. The server recomputes it from the operation's fields.
 */
export function finmapKey(accountId: string, toAccountId: string | null, identity: readonly string[], ordinal: number): string {
  return createHash('sha256').update(['finmap', accountId, toAccountId ?? '', ...identity, String(ordinal)].join('\u0001')).digest('hex').slice(0, 32)
}

/** The id of a Finmap operation: derived from its key, so a replayed write lands on the same document. */
export const finmapTxId = (key: string): string => `fm_${key}`
