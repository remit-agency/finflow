import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { BatchOp } from '@/lib/domain/import/finmap/request'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { finmapBatch } from '@/lib/server/imports/finmap/batch'
import { acquireAll, releaseAll, withAccountLocks } from '@/lib/server/imports/step'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-10-27T10:00:00Z')
const LEASE_MS = 60_000

/** Deps whose clock reads `now` (the lease and its expiry depend on it). */
function depsAt(now: Date = NOW): ImportDeps {
  const ledger = makeDeps(db, { now: () => now })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

const lockRef = (id: string) => db.doc(`organizations/${ORG}/importLocks/${id}`)
const refs = (...ids: string[]) => ids.map(lockRef)
const lockOf = async (id: string) => (await lockRef(id).get()).data()

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db, ORG)
  await seedAccount(db, ORG, 'pln1', 'PLN', 0)
  await seedAccount(db, ORG, 'pln2', 'PLN', 0)
  await seedCategory(db, ORG, 'exp', 'expense')
  await seedFinmapImport(db, ORG, 'imp1')
})

/** An applied Finmap import of the company, as the setup step writes it. */
async function seedFinmapImport(store: Firestore, orgId: string, id: string): Promise<void> {
  await store.doc(`organizations/${orgId}/imports/${id}`).set({
    schemaVersion: 1,
    kind: 'finmap',
    fileName: 'synthetic.xlsx',
    accountIds: [],
    createdAt: Timestamp.fromDate(NOW),
    createdBy: UID,
    period: { from: null, to: null },
    counts: { created: 0, skipped: 0, refused: 0 },
    statements: [],
    fit: {},
    fitTargets: {},
    entities: { accounts: 0, categories: 0, counterparties: 0, tags: 0 },
    status: 'applied',
    undo: { deleted: 0, kept: 0 },
  })
}

describe('the account step locks of one request: taken together, freed together', () => {
  it('acquireAll writes every lock with the holder token and the lease', async () => {
    await acquireAll(depsAt(), refs('pln1', 'pln2'), 'first')
    expect(await lockOf('pln1')).toEqual({ until: NOW.getTime() + LEASE_MS, token: 'first' })
    expect(await lockOf('pln2')).toEqual({ until: NOW.getTime() + LEASE_MS, token: 'first' })
  })

  it('an overlapping request on a shared account gets already_running and takes none of its other locks', async () => {
    await acquireAll(depsAt(), refs('pln1'), 'first')
    await expect(acquireAll(depsAt(), refs('pln2', 'pln1'), 'second')).rejects.toMatchObject({ code: 'already_running' })
    expect((await lockRef('pln2').get()).exists).toBe(false)
    expect(await lockOf('pln1')).toEqual({ until: NOW.getTime() + LEASE_MS, token: 'first' })
  })

  it('a finmap batch that overlaps a held account writes nothing and leaves the other account unlocked', async () => {
    await acquireAll(depsAt(), refs('pln1'), 'someone')
    const ops: BatchOp[] = [
      { kind: 'expense', status: 'actual', day: '2026-09-01', amountMinor: 1000, accountId: 'pln2', toAccountId: null, toAmountMinor: null, categoryId: 'exp', counterpartyId: null, tagIds: [], description: null, accrual: null, identity: ['a'], ordinal: 0 },
      { kind: 'expense', status: 'actual', day: '2026-09-02', amountMinor: 2000, accountId: 'pln1', toAccountId: null, toAmountMinor: null, categoryId: 'exp', counterpartyId: null, tagIds: [], description: null, accrual: null, identity: ['b'], ordinal: 0 },
    ]
    await expect(finmapBatch(depsAt(), ORG, UID, { importId: 'imp1', operations: ops })).rejects.toMatchObject({ code: 'already_running' })
    expect((await lockRef('pln2').get()).exists).toBe(false)
    expect((await db.collection(`organizations/${ORG}/transactions`).get()).size).toBe(0)
  })

  it('a lock whose lease ran out is taken over as before', async () => {
    await lockRef('pln1').set({ until: NOW.getTime() - 1, token: 'old' })
    await acquireAll(depsAt(), refs('pln1'), 'new')
    expect(await lockOf('pln1')).toEqual({ until: NOW.getTime() + LEASE_MS, token: 'new' })
  })

  it('releasing does not remove a lock another holder took after this one expired', async () => {
    await acquireAll(depsAt(), refs('pln1', 'pln2'), 'mine')
    // The lease ran out; another request took pln1 later.
    const later = depsAt(new Date(NOW.getTime() + LEASE_MS + 1000))
    await acquireAll(later, refs('pln1'), 'other')
    await releaseAll(later, refs('pln1', 'pln2'), 'mine')
    expect((await lockOf('pln1'))?.token).toBe('other')
    expect(await lockOf('pln2')).toEqual({ until: 0, token: null })
  })

  it('withAccountLocks frees its locks when the work throws', async () => {
    await expect(
      withAccountLocks(depsAt(), ORG, ['pln1', 'pln2'], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await lockOf('pln1')).toEqual({ until: 0, token: null })
    expect(await lockOf('pln2')).toEqual({ until: 0, token: null })
  })
})
