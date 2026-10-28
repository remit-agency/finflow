import type { LedgerTransaction } from '@/lib/domain/ledger/types'

/** One line of the journal: the operation and the account balance after it (null for a planned one). */
export interface JournalRow {
  tx: LedgerTransaction
  balanceAfterMinor: number | null
}

export interface JournalPage {
  rows: JournalRow[]
  /** Pass back to read the next page; null when there is nothing more. */
  next: string | null
}
