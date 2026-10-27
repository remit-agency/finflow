import { Timestamp, type Transaction } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerDeps } from './deps'
import { lockRef } from './paths'

export const LOCK_MS = 5 * 60 * 1000

function active(until: unknown, now: Date): boolean {
  return until instanceof Timestamp && until.toMillis() > now.getTime()
}

/** Inside a write transaction: refuses while a rebuild holds the lock. Costs one read. */
export async function assertUnlocked(t: Transaction, deps: LedgerDeps, orgId: string): Promise<void> {
  const snap = await t.get(lockRef(deps.db, orgId))
  if (snap.exists && active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
}

/** Takes the lease for LOCK_MS or throws ledger_busy. */
export async function acquireLock(deps: LedgerDeps, orgId: string, holder: string): Promise<void> {
  const ref = lockRef(deps.db, orgId)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (snap.exists && active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
    t.set(ref, { until: Timestamp.fromMillis(deps.now().getTime() + LOCK_MS), holder })
  })
}

export async function releaseLock(deps: LedgerDeps, orgId: string): Promise<void> {
  await lockRef(deps.db, orgId).delete()
}
