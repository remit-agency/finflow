import type { JournalFilters } from '@/lib/domain/journal/filter'
import type { JournalPage } from '@/lib/domain/journal/types'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { fetchJournalPage } from './journal-client'

/** «Select all matching the filter» takes at most this many rows. */
export const SELECT_ALL_LIMIT = 1000
const PAGE = 100
/** A scan that finds nothing answers empty pages with a cursor; this many pages in a row ends the walk. */
const MAX_PAGES = 200

type FetchPage = (cursor: string | null, signal?: AbortSignal) => Promise<JournalPage>

/**
 * Pages the journal for `filters` (100 rows a time) until `SELECT_ALL_LIMIT` rows are in hand or the cursor runs out.
 * `limitReached` is true when more rows match than were taken (the first `SELECT_ALL_LIMIT` are returned). Throws what
 * the fetch throws, including an abort.
 */
export async function collectMatching(
  orgId: string,
  filters: JournalFilters,
  opts: { signal?: AbortSignal; fetchPage?: FetchPage } = {},
): Promise<{ rows: LedgerTransaction[]; limitReached: boolean }> {
  const fetchPage: FetchPage =
    opts.fetchPage ?? ((cursor, signal) => fetchJournalPage(orgId, filters, cursor, { signal, limit: PAGE }))
  const rows: LedgerTransaction[] = []
  let cursor: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const page: JournalPage = await fetchPage(cursor, opts.signal)
    for (const row of page.rows) rows.push(row.tx)
    cursor = page.next
    if (rows.length > SELECT_ALL_LIMIT) return { rows: rows.slice(0, SELECT_ALL_LIMIT), limitReached: true }
    if (cursor === null) return { rows, limitReached: false }
  }
  // Out of pages with the cursor still open: more may match.
  return { rows, limitReached: true }
}
