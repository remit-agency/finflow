// Regression tests for the review of S05: rollup keys named like Object.prototype members, lock ownership, provenance.
import type { Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { LOCK_MS, acquireLock, releaseLock, renewLock } from '@/lib/server/ledger/lock'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
const lockPath = `organizations/${ORG}/ledger/lock`

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? e.code : `other:${String(e)}`
  }
  return 'none'
}

const income = (over: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1000, paymentDate: '2026-10-20', ...over })

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'pln1', 'PLN', 0)
  await seedCategory(db, ORG, 'ci1', 'income')
  await seedCategory(db, ORG, 'constructor', 'income')
})

describe('a category id that is a member of Object.prototype', () => {
  it('keeps both categories in the rollup document and the ledger verifies', async () => {
    await createTransaction(deps, ORG, UID, income({ categoryId: 'ci1' }))
    await createTransaction(deps, ORG, UID, income({ categoryId: 'constructor', amountMinor: 500, paymentDate: '2026-10-21' }))

    const pl = await rollup(db, ORG, 'pl_2026-10')
    expect(pl).toEqual({ 'categories.ci1.incomeBase': 1000, 'categories.constructor.incomeBase': 500 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual(pl)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(({} as Record<string, unknown>).incomeBase).toBeUndefined()

    await rebuildLedger(deps, ORG, UID, { apply: true })
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual(pl)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('lock ownership', () => {
  const t0 = new Date('2026-10-27T10:00:00Z').getTime()
  const at = (ms: number) => makeDeps(db, { now: () => new Date(t0 + ms) })
  const six = 6 * 60_000

  it('an expired lease taken over by B survives A releasing; A cannot renew; writes stay refused', async () => {
    const a = await acquireLock(at(0), ORG, 'rebuild-A')
    const b = await acquireLock(at(six), ORG, 'rebuild-B')
    expect(a).not.toBe(b)

    await releaseLock(at(six), ORG, a)
    const stored = await readDoc(db, lockPath)
    expect(stored).toMatchObject({ holder: b, by: 'rebuild-B' })

    expect(await code(renewLock(at(six), ORG, a))).toBe('ledger_busy')
    expect(await code(createTransaction(at(six), ORG, UID, income()))).toBe('ledger_busy')

    await releaseLock(at(six), ORG, b)
    expect(await readDoc(db, lockPath)).toBeUndefined()
    await createTransaction(at(six), ORG, UID, income())
  })

  it('renew extends the lease from now; a lease that already expired cannot be renewed', async () => {
    const token = await acquireLock(at(0), ORG, 'A')
    await renewLock(at(LOCK_MS - 1000), ORG, token)
    expect(await code(createTransaction(at(LOCK_MS + 1000), ORG, UID, income()))).toBe('ledger_busy')
    expect(await code(renewLock(at(LOCK_MS - 1000 + LOCK_MS + 1), ORG, token))).toBe('ledger_busy')
  })

  it('a second acquire while the lease is valid is refused', async () => {
    await acquireLock(at(0), ORG, 'A')
    expect(await code(acquireLock(at(1000), ORG, 'B'))).toBe('ledger_busy')
  })

  it('rebuild with a token it was given neither acquires nor releases the lock', async () => {
    await createTransaction(deps, ORG, UID, income())
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 7 })
    const token = await acquireLock(deps, ORG, 'migration')
    const out = await rebuildLedger(deps, ORG, 'migration', { apply: true, lock: token })
    expect(out.applied).toBe(true)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(1000)
    expect(await readDoc(db, lockPath)).toMatchObject({ holder: token })
    expect(await code(createTransaction(deps, ORG, UID, income()))).toBe('ledger_busy')
  })

  it('rebuild with a token whose lease was lost writes nothing and leaves the new holder alone', async () => {
    await createTransaction(deps, ORG, UID, income())
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 7 })
    const a = await acquireLock(at(0), ORG, 'A')
    const b = await acquireLock(at(six), ORG, 'B')
    expect(await code(rebuildLedger(at(six), ORG, 'A', { apply: true, lock: a }))).toBe('ledger_busy')
    expect(await balanceOf(db, ORG, 'pln1')).toBe(7)
    expect(await readDoc(db, lockPath)).toMatchObject({ holder: b })
  })

  it('a rebuild that loses its lease between batches stops writing and releases what it still holds', async () => {
    // 450 operations on distinct days: well over one batch of rollup documents.
    const seed = db.batch()
    for (let i = 0; i < 450; i++) {
      const day = addDays('2025-01-01', i)
      const tx = { id: `t${i}`, type: 'income' as const, status: 'actual' as const, accountId: 'pln1', amountMinor: 1, currency: 'PLN', paymentDate: day,
        accrual: { mode: 'date' as const, date: day }, isRecurring: false, tags: [], fileUrls: [] }
      seed.set(db.doc(`organizations/${ORG}/transactions/${tx.id}`), { ...transactionToDoc(tx), orgId: ORG })
    }
    await seed.commit()

    let offset = 0
    const lossy = new Proxy(db, {
      get(target, prop) {
        if (prop === 'batch') {
          return () => {
            offset = 6 * 60_000 // the first batch is being built: from now on the lease counts as expired
            return target.batch()
          }
        }
        const v = Reflect.get(target, prop)
        return typeof v === 'function' ? v.bind(target) : v
      },
    }) as unknown as Firestore
    const lossyDeps = { ...makeDeps(db, { now: () => new Date(t0 + offset) }), db: lossy }

    expect(await code(rebuildLedger(lossyDeps, ORG, 'A', { apply: true }))).toBe('ledger_busy')
    expect(await auditActions(db, ORG)).toEqual([]) // the audit entry is the last write: the run never got there
    expect(await readDoc(db, lockPath)).toBeUndefined() // released by token on the way out
  })
})

describe('migration provenance survives an edit', () => {
  it('updateTransaction keeps migratedFrom and legacy', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, income())
    await db.doc(`organizations/${ORG}/transactions/${transaction.id}`).update({ migratedFrom: 'v1', legacy: { currency: 'USD' } })

    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ amountMinor: 2500 }))
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).toMatchObject({ amountMinor: 2500, migratedFrom: 'v1', legacy: { currency: 'USD' } })
  })

  it('a document without provenance does not get any', async () => {
    const { transaction } = await createTransaction(deps, ORG, UID, income())
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ amountMinor: 2500 }))
    const doc = await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)
    expect(doc).not.toHaveProperty('migratedFrom')
    expect(doc).not.toHaveProperty('legacy')
  })
})
