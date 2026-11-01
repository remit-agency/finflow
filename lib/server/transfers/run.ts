import { Timestamp } from 'firebase-admin/firestore'
import type { TransferOutcome, TransferRequest } from '@/lib/domain/transfers/types'
import { parseVersion } from '@/lib/domain/transfers/version'
import { refusalCode } from '@/lib/server/ledger/http'
import type { MadeTransfer, TransferJob } from '@/lib/server/ledger/transfer'

/** The ledger call a transfer request is made of (the production `ledger` object has it). */
export interface TransferLedger {
  makeTransfer(orgId: string, uid: string, job: TransferJob): Promise<MadeTransfer>
}

interface Planned {
  ids: string[]
  job: TransferJob
}

function timestampOf(version: string): Timestamp {
  const parts = parseVersion(version)
  // parseTransferRequest has checked every version of the request.
  if (parts === null) throw new Error('an unparsed version reached runTransfers')
  return new Timestamp(parts.seconds, parts.nanoseconds)
}

function plan(req: TransferRequest): Planned[] {
  switch (req.kind) {
    case 'pairs':
      return req.pairs.map((p): Planned => ({ ids: [...p.ids], job: { mode: 'pair', ids: p.ids, versions: [timestampOf(p.versions[0]), timestampOf(p.versions[1])] } }))
    case 'merge':
      return [{ ids: [...req.ids], job: { mode: 'pair', ids: req.ids } }]
    case 'convert':
      return req.ids.map((id): Planned => ({ ids: [id], job: { mode: 'convert', id, toAccountId: req.toAccountId } }))
  }
}

/**
 * Runs a transfer request one pair or one operation at a time, each its own Firestore transaction (S10b). A refusal is that
 * item's result and the rest go on; so is an unexpected error (`unknown`, logged once by ids, never with the body).
 */
export async function runTransfers(ledger: TransferLedger, orgId: string, uid: string, req: TransferRequest): Promise<TransferOutcome[]> {
  const out: TransferOutcome[] = []
  for (const { ids, job } of plan(req)) {
    try {
      const made = await ledger.makeTransfer(orgId, uid, job)
      out.push({ ids, ok: true, id: made.transaction.id, deletedId: made.deletedId, droppedTags: made.droppedTags, before: made.before })
    } catch (e) {
      const code = refusalCode(e)
      if (code === null) console.error('[transfers] unexpected error', { orgId, ids, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
      out.push({ ids, ok: false, code: code ?? 'unknown' })
    }
  }
  return out
}
