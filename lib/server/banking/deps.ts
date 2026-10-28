import type { Firestore } from 'firebase-admin/firestore'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import type { EbApi } from './eb-api'

export interface BankDeps {
  db: Firestore
  eb: EbApi
  ledger: LedgerDeps
  now: () => Date
  /** The Warsaw day, YYYY-MM-DD. */
  today: () => string
}
