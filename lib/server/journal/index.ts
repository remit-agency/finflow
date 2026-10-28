import 'server-only'
import { toDay } from '@/lib/domain/ledger/days'
import type { BulkRequest } from '@/lib/domain/journal/bulk-input'
import { getAdmin } from '@/lib/server/firebase-admin'
import { resolveRate } from '@/lib/server/fx'
import { ledger } from '@/lib/server/ledger'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { todayUtcDay } from '@/lib/utils/today'
import { runBulk } from './bulk'
import { readJournalPage, readOneTransaction, type ReadOptions } from './read'

function deps(): LedgerDeps {
  return { db: getAdmin().db, resolveRate, now: () => new Date(), today: () => toDay(todayUtcDay()) }
}

/** The journal bound to the production Firestore. */
export const journal = {
  readPage: async (orgId: string, opts: ReadOptions) => {
    const { rows, next } = await readJournalPage(deps(), orgId, opts)
    return { rows, next }
  },
  readOne: (orgId: string, txId: string) => readOneTransaction(deps(), orgId, txId),
  bulk: (orgId: string, uid: string, req: BulkRequest) => runBulk(ledger, orgId, uid, req),
}
