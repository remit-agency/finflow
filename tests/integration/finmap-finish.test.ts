import { beforeEach, describe, expect, it } from 'vitest'
import { normKey } from '@/lib/domain/import/finmap/fold'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { MAX_MINOR } from '@/lib/domain/ledger/money'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { ImportError } from '@/lib/server/imports/errors'
import { finmapFinish } from '@/lib/server/imports/finmap/finish'
import { finmapSetup } from '@/lib/server/imports/finmap/setup'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedOrg, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-11-20T10:00:00Z')
const path = (col: string) => `organizations/${ORG}/${col}`

function depsFor(): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

/**
 * A Finmap import with one new account that was given `balanceMinor` (or none), then two operations on it: +300.00 and
 * -50.00. The account balance is 250.00 and its opening 0.
 */
async function setupWith(balanceMinor: number | null): Promise<{ importId: string; account: string }> {
  const r = await finmapSetup(depsFor(), ORG, UID, {
    fileName: 'Platnosci.xlsx',
    accounts: [{ name: 'Karta', type: 'card', currency: 'PLN', currentBalanceMinor: balanceMinor }],
    categories: [],
    counterparties: [],
    tags: [],
  })
  const account = r.accounts[normKey('Karta')]
  const ledger = depsFor().ledger
  await createTransaction(ledger, ORG, UID, parseTransactionInput({ type: 'income', accountId: account, amountMinor: 30_000, paymentDate: '2026-10-20' }))
  await createTransaction(ledger, ORG, UID, parseTransactionInput({ type: 'expense', accountId: account, amountMinor: 5_000, paymentDate: '2026-10-21' }))
  return { importId: r.importId, account }
}

describe('finmapFinish', () => {
  beforeEach(async () => {
    await clearFirestore()
    await seedOrg(db)
  })

  it('fits the opening so the balance equals the target, and marks the account done', async () => {
    const { importId, account } = await setupWith(100_000)
    expect(await balanceOf(db, ORG, account)).toBe(25_000)

    const r = await finmapFinish(depsFor(), ORG, UID, importId)

    expect(r).toEqual({ fitted: [{ accountId: account, openingMinor: 75_000 }], differences: [{ accountId: account, differenceMinor: 0 }] })
    expect(await balanceOf(db, ORG, account)).toBe(100_000)
    expect(await readDoc(db, `${path('accounts')}/${account}`)).toMatchObject({ openingMinor: 75_000, balanceMinor: 100_000 })
    expect(await readDoc(db, `${path('imports')}/${importId}`)).toMatchObject({ fit: { [account]: 'done' } })
  })

  it('a second finish changes nothing: the account is not fitted again', async () => {
    const { importId, account } = await setupWith(100_000)
    await finmapFinish(depsFor(), ORG, UID, importId)
    const audits = (await db.collection(path('audit')).get()).size

    const again = await finmapFinish(depsFor(), ORG, UID, importId)

    expect(again).toEqual({ fitted: [], differences: [{ accountId: account, differenceMinor: 0 }] })
    expect(await readDoc(db, `${path('accounts')}/${account}`)).toMatchObject({ openingMinor: 75_000, balanceMinor: 100_000 })
    expect((await db.collection(path('audit')).get()).size).toBe(audits)
  })

  it('a target above the ledger range is reported as a difference and not fitted', async () => {
    const { importId, account } = await setupWith(-MAX_MINOR)

    const r = await finmapFinish(depsFor(), ORG, UID, importId)

    // The opening that would make the balance equal -MAX_MINOR is out of range: the difference is balance - target.
    expect(r).toEqual({ fitted: [], differences: [{ accountId: account, differenceMinor: 25_000 + MAX_MINOR }] })
    expect(await readDoc(db, `${path('accounts')}/${account}`)).toMatchObject({ openingMinor: 0, balanceMinor: 25_000 })
    expect(await readDoc(db, `${path('imports')}/${importId}`)).toMatchObject({ fit: {} })
  })

  it('an import without targets returns empty lists', async () => {
    const { importId } = await setupWith(null)
    expect(await finmapFinish(depsFor(), ORG, UID, importId)).toEqual({ fitted: [], differences: [] })
  })

  it('refuses an import that is not an applied Finmap import of this company', async () => {
    const { importId } = await setupWith(100_000)
    await db.doc(`${path('imports')}/${importId}`).update({ status: 'undone' })
    await expect(finmapFinish(depsFor(), ORG, UID, importId)).rejects.toBeInstanceOf(ImportError)
    await expect(finmapFinish(depsFor(), ORG, UID, 'no-such-import')).rejects.toMatchObject({ code: 'not_found' })
  })
})
