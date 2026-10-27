import { randomUUID } from 'node:crypto'
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

/**
 * Takes the lease for LOCK_MS or throws ledger_busy. Returns the token that proves ownership: `renewLock` and
 * `releaseLock` act only while the stored holder is that token. `by` (who asked) is kept for people reading the document.
 */
export async function acquireLock(deps: LedgerDeps, orgId: string, by: string): Promise<string> {
  const ref = lockRef(deps.db, orgId)
  const token = randomUUID()
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (snap.exists && active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
    t.set(ref, { until: Timestamp.fromMillis(deps.now().getTime() + LOCK_MS), holder: token, by })
  })
  return token
}

/** Extends the lease to now + LOCK_MS. Throws ledger_busy when the lease expired or somebody else holds the lock. */
export async function renewLock(deps: LedgerDeps, orgId: string, token: string): Promise<void> {
  const ref = lockRef(deps.db, orgId)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists || snap.get('holder') !== token || !active(snap.get('until'), deps.now())) throw new LedgerError('ledger_busy')
    t.update(ref, { until: Timestamp.fromMillis(deps.now().getTime() + LOCK_MS) })
  })
}

/** Deletes the lock only when `token` still holds it (a lease that was taken over belongs to its new holder). */
export async function releaseLock(deps: LedgerDeps, orgId: string, token: string): Promise<void> {
  const ref = lockRef(deps.db, orgId)
  await deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (snap.exists && snap.get('holder') === token) t.delete(ref)
  })
}
