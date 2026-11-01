import { addDays } from '@/lib/domain/ledger/days'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import { CANDIDATE_FIELDS, findTransferPairs, parseCandidate } from '@/lib/domain/transfers/pairs'
import { SUGGEST_DAYS, SUGGEST_SCAN, type Candidate, type SuggestionsResult } from '@/lib/domain/transfers/types'
import { encodeVersion } from '@/lib/domain/transfers/version'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { transactionsCol } from '@/lib/server/ledger/paths'

export interface SuggestionsRead extends SuggestionsResult {
  /** Operations read (at most SUGGEST_SCAN). */
  scanned: number
  /** Of those, bank incomes and expenses that can be a side of a transfer. */
  bankSides: number
}

/**
 * The suggested own transfers of a company (S10b), computed on demand, nothing stored. One query: the operations whose
 * payment day is within the last SUGGEST_DAYS up to today (planned operations, later days, are not transfers yet), newest
 * first, at most SUGGEST_SCAN, only the fields the finder needs (Firestore cannot pick the bank operations without an index
 * of its own, so they are picked in memory). Each side carries its document version, which a confirmation sends back.
 */
export async function readTransferSuggestions(deps: Pick<LedgerDeps, 'db' | 'today'>, orgId: string): Promise<SuggestionsRead> {
  const today = deps.today()
  const snap = await transactionsCol(deps.db, orgId)
    .where('paymentDate', '>=', addDays(today, -SUGGEST_DAYS))
    .where('paymentDate', '<=', today)
    .orderBy('paymentDate', 'desc')
    .select(...CANDIDATE_FIELDS)
    .limit(SUGGEST_SCAN)
    .get()
  const cands: Candidate[] = []
  for (const d of snap.docs) {
    const c = parseCandidate(d.id, d.data(), encodeVersion(d.updateTime))
    if (c) cands.push(c)
  }
  return {
    ...findTransferPairs(cands),
    truncated: snap.size >= SUGGEST_SCAN,
    scanned: snap.size,
    bankSides: cands.filter((c) => bankSideOf(c) !== null).length,
  }
}
