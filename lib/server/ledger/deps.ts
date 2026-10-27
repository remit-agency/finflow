import type { Firestore } from 'firebase-admin/firestore'
import type { RateSnapshot } from '@/lib/server/fx/types'

export interface LedgerDeps {
  db: Firestore
  /** NBP table A rate snapshot (S04). */
  resolveRate: (from: string, to: string, date: string) => Promise<RateSnapshot>
  now: () => Date
  /** The Warsaw day, YYYY-MM-DD. */
  today: () => string
}
