import 'server-only'
import type { TransferRequest } from '@/lib/domain/transfers/types'
import { ledger, ledgerDeps } from '@/lib/server/ledger'
import { readTransferSuggestions } from './read'
import { runTransfers } from './run'

/** Own transfers (S10b) bound to the production Firestore, NBP rates and the Warsaw clock. */
export const transfers = {
  /** What the journal offers: the pairs, how many there are, the ambiguous sides, whether the read was cut. */
  suggestions: async (orgId: string) => {
    const { pairs, total, ambiguous, truncated } = await readTransferSuggestions(ledgerDeps(), orgId)
    return { pairs, total, ambiguous, truncated }
  },
  run: (orgId: string, uid: string, req: TransferRequest) => runTransfers(ledger, orgId, uid, req),
  split: (orgId: string, uid: string, txId: string) => ledger.splitTransfer(orgId, uid, txId),
}
