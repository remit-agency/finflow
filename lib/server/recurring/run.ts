import type { MatchOutcome, MatchRequest } from '@/lib/domain/recurring/types'
import { refusalCode } from '@/lib/server/ledger/http'
import type { MatchDone, MatchJob } from '@/lib/server/ledger/plan-match'
import { timestampOf } from '@/lib/server/ledger/version'

/** The ledger calls a match request is made of (the production `ledger` object has them). */
export interface MatchLedger {
  confirmMatch(orgId: string, uid: string, job: MatchJob): Promise<MatchDone>
  undoMatch(orgId: string, uid: string, planId: string): Promise<MatchDone>
}

/**
 * Runs a match request one pair (or one undo) at a time, each its own Firestore transaction (S11). A refusal is that item's
 * result and the rest go on; so is an unexpected error (`unknown`, logged once by ids, never with the body).
 */
export async function runMatches(ledger: MatchLedger, orgId: string, uid: string, req: MatchRequest): Promise<MatchOutcome[]> {
  const items =
    req.kind === 'confirm'
      ? req.items.map((i) => ({
          planId: i.planId,
          run: () => ledger.confirmMatch(orgId, uid, { planId: i.planId, bankId: i.bankId, versions: [timestampOf(i.versions[0]), timestampOf(i.versions[1])] }),
        }))
      : req.planIds.map((planId) => ({ planId, run: () => ledger.undoMatch(orgId, uid, planId) }))
  const out: MatchOutcome[] = []
  for (const { planId, run } of items) {
    try {
      const done = await run()
      out.push({ planId, ok: true, bankId: done.bank.id })
    } catch (e) {
      const code = refusalCode(e)
      if (code === null) console.error('[recurring] unexpected error', { orgId, planId, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
      out.push({ planId, ok: false, code: code ?? 'unknown' })
    }
  }
  return out
}
