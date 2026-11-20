import type { Firestore } from 'firebase-admin/firestore'
import type { LedgerDeps } from '@/lib/server/ledger/deps'

export interface ImportDeps {
  db: Firestore
  ledger: LedgerDeps
  now: () => Date
  /** The Warsaw day, YYYY-MM-DD. */
  today: () => string
}
