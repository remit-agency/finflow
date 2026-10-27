import { Timestamp, type WriteBatch } from 'firebase-admin/firestore'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { nest } from '@/lib/domain/ledger/rollups'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { acquireLock, releaseLock } from './lock'
import { accountsCol, auditCol, rollupsCol } from './paths'
import { buildReport, loadLedger, verifyLedger, type LedgerReport } from './verify'

const BATCH_SIZE = 400

export interface RebuildResult extends LedgerReport {
  applied: boolean
}

/**
 * Dry run (`apply: false`) = verifyLedger. With `apply: true`: takes the ledger lock (writes answer
 * ledger_busy meanwhile), recomputes balances and rollups from the operations, overwrites what differs,
 * deletes stale rollup documents and writes an audit entry. The returned report describes what was found.
 */
export async function rebuildLedger(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  opts: { apply: boolean },
): Promise<RebuildResult> {
  if (!opts.apply) return { ...(await verifyLedger(deps, orgId)), applied: false }

  await acquireLock(deps, orgId, uid)
  try {
    const data = await loadLedger(deps, orgId)
    const expected = computeLedger(data.accounts, data.txs, data.baseCurrency)
    const report = buildReport(data, expected)
    const ts = Timestamp.fromDate(deps.now())

    const ops: Array<(batch: WriteBatch) => void> = []
    for (const account of data.accounts) {
      if (account.balanceMinor !== expected.balances[account.id]) {
        ops.push((b) => b.update(accountsCol(deps.db, orgId).doc(account.id), { balanceMinor: expected.balances[account.id], updatedAt: ts }))
      }
    }
    for (const id of data.storedRollups.keys()) {
      if (!expected.rollups.has(id)) ops.push((b) => b.delete(rollupsCol(deps.db, orgId).doc(id)))
    }
    for (const [id, flat] of expected.rollups) {
      ops.push((b) => b.set(rollupsCol(deps.db, orgId).doc(id), nest(flat)))
    }
    ops.push((b) =>
      b.create(
        auditCol(deps.db, orgId).doc(),
        auditData(deps, 'ledger.rebuild', uid, orgId, null, {
          balanceDiffs: report.balanceDiffs.length,
          rollupDiffs: report.rollupDiffs.length,
          uncountable: report.uncountable.length,
        }),
      ),
    )

    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = deps.db.batch()
      for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch)
      await batch.commit()
    }
    return { ...report, applied: true }
  } finally {
    await releaseLock(deps, orgId)
  }
}
