import { FieldValue, Timestamp, type WriteBatch } from 'firebase-admin/firestore'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { nest } from '@/lib/domain/ledger/rollups'
import { excludedFromTags } from '@/lib/domain/tags/exclude'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { acquireLock, releaseLock, renewLock } from './lock'
import { accountsCol, auditCol, rollupsCol, transactionsCol } from './paths'
import { buildReport, loadLedger, verifyLedger, withTagFlags, type LedgerReport } from './verify'

const BATCH_SIZE = 400

export interface RebuildResult extends LedgerReport {
  applied: boolean
}

/**
 * Dry run (`apply: false`) = verifyLedger. With `apply: true`: takes the ledger lock (writes answer
 * ledger_busy meanwhile), recomputes balances and rollups from the operations (their `excluded` taken from the tags as
 * they are now, S10t), overwrites what differs, sets the stored `excluded` flags again, deletes stale rollup documents
 * and writes an audit entry. The returned report describes what was found.
 */
export async function rebuildLedger(
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  opts: { apply: boolean; lock?: string },
): Promise<RebuildResult> {
  if (!opts.apply) return { ...(await verifyLedger(deps, orgId)), applied: false }

  // A caller that already holds the lock (the migration) passes its token and keeps ownership of the release.
  const token = opts.lock ?? (await acquireLock(deps, orgId, uid))
  try {
    const data = await loadLedger(deps, orgId)
    const expected = computeLedger(data.accounts, withTagFlags(data), data.baseCurrency)
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
    // S10t: the stored flag follows the tags again (the rollups above already count it so).
    for (const tx of data.txs) {
      const want = excludedFromTags(tx.tags, data.tags)
      if (want !== (tx.excluded === true)) {
        ops.push((b) => b.update(transactionsCol(deps.db, orgId).doc(tx.id), { excluded: want ? true : FieldValue.delete() }))
      }
    }
    ops.push((b) =>
      b.create(
        auditCol(deps.db, orgId).doc(),
        auditData(deps, 'ledger.rebuild', uid, orgId, null, {
          balanceDiffs: report.balanceDiffs.length,
          rollupDiffs: report.rollupDiffs.length,
          uncountable: report.uncountable.length,
          excludedDiffs: report.excludedDiffs.length,
        }),
      ),
    )

    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      // The lease is 5 minutes and nobody else renews it: prove we still own it before every batch, and stop when we do not.
      await renewLock(deps, orgId, token)
      const batch = deps.db.batch()
      for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch)
      await batch.commit()
    }
    return { ...report, applied: true }
  } finally {
    if (opts.lock === undefined) await releaseLock(deps, orgId, token)
  }
}
