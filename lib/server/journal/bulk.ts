import type { BulkOutcome, BulkRequest } from '@/lib/domain/journal/bulk-input'
import type { TransactionPatch } from '@/lib/domain/ledger/input'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

/** The two ledger calls a bulk change is made of (the production `ledger` object has them). */
export interface BulkLedger {
  updateTransaction(orgId: string, uid: string, txId: string, patch: TransactionPatch): Promise<unknown>
  deleteTransaction(orgId: string, uid: string, txId: string): Promise<unknown>
}

/**
 * One operation at a time through the same validation and Firestore transaction as an edit in the form, so balances,
 * rollups and the audit trail are right by construction. A refusal (a ledger or rate error) is that row's outcome and the
 * rest go on; so is an unexpected error (outcome `unknown`, logged once): rethrowing would lose the outcomes of the rows
 * already applied, and the browser could neither report them nor offer their undo.
 */
export async function runBulk(ledger: BulkLedger, orgId: string, uid: string, req: BulkRequest): Promise<BulkOutcome[]> {
  const out: BulkOutcome[] = []
  for (const id of req.ids) {
    try {
      if (req.action === 'delete') await ledger.deleteTransaction(orgId, uid, id)
      else await ledger.updateTransaction(orgId, uid, id, req.patch as TransactionPatch)
      out.push({ id, ok: true })
    } catch (e) {
      const mapped = toHttpError(e)
      if (mapped instanceof HttpError && (mapped.status < 500 || mapped.status === 503)) {
        // The short code is the error message (`new HttpError(status, code, extra?)`).
        out.push({ id, ok: false, code: mapped.message })
      } else {
        // No request body, tokens or patch in the log: the org, the operation and what went wrong.
        console.error('[journal.bulk] unexpected error', { orgId, txId: id, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
        out.push({ id, ok: false, code: 'unknown' })
      }
    }
  }
  return out
}
