import type { Firestore } from 'firebase-admin/firestore'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'

export interface CounterpartyDeps {
  db: Firestore
  now: () => Date
  /** The Warsaw day, `YYYY-MM-DD`. */
  today: () => string
  /** Asks the MF white list. Throws `lookup_unavailable` when it cannot be asked. */
  lookup: (nip: string) => Promise<WhitelistLookup>
  /** Overrides the per-company limit (tests). */
  maxCount?: number
}
