import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { fullPatch, parseTransactionInput, parseTransactionPatch, toRawInput } from '@/lib/domain/ledger/input'
import { acquireLock } from '@/lib/server/ledger/lock'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ACCOUNTS, randomTx, rng } from '@/tests/unit/domain/ledger/model'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? e.code : `other:${String(e)}`
  }
  return 'none'
}

async function seedWorld(): Promise<void> {
  await clearFirestore()
  await seedOrg(db)
  for (const a of ACCOUNTS) await seedAccount(db, ORG, a.id, a.currency, a.openingMinor)
  for (const id of ['ci1', 'ci2']) await seedCategory(db, ORG, id, 'income')
  for (const id of ['ce1', 'ce2']) await seedCategory(db, ORG, id, 'expense')
}

beforeEach(seedWorld)

describe('verifyLedger', () => {
  it('an empty ledger is ok', async () => {
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, accounts: 3, transactions: 0, balanceDiffs: [], rollupDiffs: [] })
  })

  it('random create / update / delete through the server keeps balances and rollups equal to the recomputation', async () => {
    for (let seed = 1; seed <= 6; seed++) {
      await seedWorld()
      const r = rng(seed)
      const live = new Map<string, true>()
      for (let step = 0; step < 25; step++) {
        const ids = [...live.keys()]
        const roll = r()
        try {
          if (roll < 0.6 || ids.length === 0) {
            const tx = randomTx(r, 'gen')
            if (!tx) continue
            const { transaction } = await createTransaction(deps, ORG, UID, parseTransactionInput(toRawInput(tx)))
            live.set(transaction.id, true)
          } else if (roll < 0.85) {
            const id = ids[Math.floor(r() * ids.length)]
            const tx = randomTx(r, id)
            if (tx) await updateTransaction(deps, ORG, UID, id, parseTransactionPatch(fullPatch(toRawInput(tx))))
          } else {
            const id = ids[Math.floor(r() * ids.length)]
            await deleteTransaction(deps, ORG, UID, id)
            live.delete(id)
          }
        } catch (e) {
          // A refusal (a LedgerError) must change nothing; verifyLedger below proves it. Anything else is a bug.
          if (!(e instanceof LedgerError)) throw e
        }
      }
      const report = await verifyLedger(deps, ORG)
      expect(report, `seed ${seed}`).toMatchObject({ ok: true, balanceDiffs: [], rollupDiffs: [], uncountable: [] })
    }
  })

  it('reports a drifted balance and a drifted rollup', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1000, paymentDate: '2026-10-20' }))
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    await db.doc(`organizations/${ORG}/rollups/cash_pln1_2026-10-20`).update({ inMinor: 5 })
    const report = await verifyLedger(deps, ORG)
    expect(report.ok).toBe(false)
    expect(report.balanceDiffs).toEqual([{ accountId: 'pln1', stored: 123, expected: 101000 }])
    expect(report.rollupDiffs).toEqual([{ docId: 'cash_pln1_2026-10-20', field: 'inMinor', stored: 5, expected: 1000 }])
  })

  it('reports an operation it cannot read', async () => {
    await db.doc(`organizations/${ORG}/transactions/legacy`).set({ type: 'income', accountId: 'pln1', amount: 5, date: new Date() })
    const report = await verifyLedger(deps, ORG)
    expect(report.ok).toBe(false)
    expect(report.uncountable).toEqual(['legacy'])
  })
})

describe('rebuildLedger', () => {
  it('a dry run writes nothing', async () => {
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    const out = await rebuildLedger(deps, ORG, UID, { apply: false })
    expect(out.applied).toBe(false)
    expect(out.balanceDiffs).toHaveLength(1)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(123)
    expect(await auditActions(db, ORG)).toEqual([])
  })

  it('apply repairs balances and rollups, removes stale rollup documents, audits and releases the lock', async () => {
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1000, paymentDate: '2026-10-20', categoryId: 'ci1' }))
    await db.doc(`organizations/${ORG}/accounts/pln1`).update({ balanceMinor: 123 })
    await db.doc(`organizations/${ORG}/rollups/cash_pln1_2026-10-20`).update({ inMinor: 5 })
    await db.doc(`organizations/${ORG}/rollups/pl_1999-01`).set({ categories: { x: { incomeBase: 9 } } })

    const out = await rebuildLedger(deps, ORG, UID, { apply: true })
    expect(out.applied).toBe(true)
    expect(out.ok).toBe(false)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(await balanceOf(db, ORG, 'pln1')).toBe(101000)
    expect(await readDoc(db, `organizations/${ORG}/rollups/pl_1999-01`)).toBeUndefined()
    expect(await auditActions(db, ORG)).toEqual(['ledger.rebuild', 'tx.create'])
    // the lock is gone: writes work
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'pln1', amountMinor: 1, paymentDate: '2026-10-20' }))
  })

  it('refuses while someone else holds the lock', async () => {
    await acquireLock(deps, ORG, 'other')
    expect(await code(rebuildLedger(deps, ORG, UID, { apply: true }))).toBe('ledger_busy')
  })
})
