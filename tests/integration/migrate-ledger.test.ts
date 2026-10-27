import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { dropLegacy, migrateOrg } from '@/scripts/lib/migrate-ledger-v2'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { ORG, auditActions, clearFirestore, fakeResolveRate, makeDeps, readDoc, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)
const OPTS = { apply: true, resetOpening: new Set<string>() }
const DRY = { apply: false, resetOpening: new Set<string>() }
const DAY = Timestamp.fromDate(new Date('2026-10-20T00:00:00Z'))

const acct = (id: string) => `organizations/${ORG}/accounts/${id}`
const txPath = (id: string) => `organizations/${ORG}/transactions/${id}`

async function seedLegacy(): Promise<void> {
  await clearFirestore()
  await seedOrg(db)
  await db.doc(acct('a')).set({ orgId: ORG, name: 'Main', type: 'bank', currency: 'PLN', balance: 1234.5, color: '#112233' })
  await db.doc(acct('e')).set({ orgId: ORG, name: 'Euro', type: 'cash', currency: 'EUR', balance: 10 })
  const tx = (id: string, data: Record<string, unknown>) => db.doc(txPath(id)).set({ orgId: ORG, accountId: 'a', date: DAY, ...data })
  await tx('i1', { type: 'income', amount: 1234.6, description: 'first', categoryId: null })
  await tx('i2', { type: 'income', amount: 10 })
  await tx('x1', { type: 'expense', amount: 10 })
  await tx('tr', { type: 'transfer', amount: 5, counterpartyId: 'e' })
  await tx('ei', { type: 'income', amount: 3, accountId: 'e', currency: 'USD' })
  await tx('bad', { type: 'income', amount: 'lots' })
}

async function snapshot(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const col of ['accounts', 'transactions', 'audit', 'rollups', 'ledger']) {
    for (const doc of (await db.collection(`organizations/${ORG}/${col}`).get()).docs) out[doc.ref.path] = doc.data()
  }
  return out
}

const migrations = async () => (await auditActions(db, ORG)).filter((a) => a === 'migration.v2').length

beforeEach(seedLegacy)

describe('migrateOrg: dry run', () => {
  it('writes nothing and reports the drift, the counters and the skipped document', async () => {
    const before = await snapshot()
    const report = await migrateOrg(deps, ORG, DRY)
    expect(await snapshot()).toEqual(before)

    expect(report).toMatchObject({ applied: false, accountsToMigrate: 2, txsToMigrate: 5 })
    expect(report.skipped).toEqual([{ kind: 'tx', id: 'bad', reason: 'invalid_amount' }])
    expect(report.counters).toEqual({ currencyMismatch: 1, transferAmountAssumed: 1, futureActual: 0 })
    expect(report.drift).toEqual([
      { accountId: 'a', legacyBalanceMinor: 123450, sumMinor: 122960, openingMinor: 490 },
      { accountId: 'e', legacyBalanceMinor: 1000, sumMinor: 800, openingMinor: 200 },
    ])
    expect(report.backup.accounts.map((a) => a.id)).toEqual(['a', 'e'])
    expect(report.backup.txs).toHaveLength(5)
    expect(report.backup.txs.find((t) => t.id === 'i1')?.data.date).toBe('2026-10-20T00:00:00.000Z')
  })
})

describe('migrateOrg: apply', () => {
  it('moves accounts and operations to schema 2, keeps the legacy fields and leaves a verified ledger', async () => {
    const report = await migrateOrg(deps, ORG, OPTS)
    expect(report).toMatchObject({ applied: true, rebuildBalanceFixes: 0, rebuildTruncated: false })

    expect(await readDoc(db, acct('a'))).toMatchObject({ schemaVersion: 2, openingMinor: 490, balanceMinor: 123450, balance: 1234.5, name: 'Main' })
    expect(await readDoc(db, acct('e'))).toMatchObject({ schemaVersion: 2, openingMinor: 200, balanceMinor: 1000, balance: 10 })

    expect(await readDoc(db, txPath('i1'))).toMatchObject({
      schemaVersion: 2, migratedFrom: 'v1', status: 'actual', amountMinor: 123460, paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' }, amount: 1234.6, description: 'first',
    })
    // A legacy null that the plan leaves out must not survive: it would make the schema 2 document unreadable.
    expect((await readDoc(db, txPath('i1')))?.categoryId).toBeUndefined()
    expect(await readDoc(db, txPath('tr'))).toMatchObject({ toAccountId: 'e', toAmountMinor: 500, toCurrency: 'EUR', counterpartyId: 'e' })
    expect(await readDoc(db, txPath('ei'))).toMatchObject({
      currency: 'EUR', amountMinor: 300, legacy: { currency: 'USD' },
      fx: { payment: { from: 'EUR', to: 'PLN', rate: 4.4 }, accrual: { from: 'EUR', to: 'PLN' } },
      base: { payment: 1320, accrual: 1320 },
    })
    expect((await readDoc(db, txPath('i2')))?.fx).toBeUndefined()
    // the invalid document is left as it was
    expect((await readDoc(db, txPath('bad')))?.schemaVersion).toBeUndefined()

    expect(await migrations()).toBe(1)
    expect((await db.collection(`organizations/${ORG}/rollups`).get()).empty).toBe(false)
    // `bad` stays legacy and is reported as uncountable; everything else is consistent
    const verify = await verifyLedger(deps, ORG)
    expect(verify).toMatchObject({ balanceDiffs: [], rollupDiffs: [], unreadableAccounts: [], uncountable: ['bad'] })
  })

  it('a ledger without skipped documents verifies ok', async () => {
    await db.doc(txPath('bad')).delete()
    await migrateOrg(deps, ORG, OPTS)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('is idempotent: a second apply changes no account or operation and adds no migration entry', async () => {
    await migrateOrg(deps, ORG, OPTS)
    const before = await snapshot()
    const second = await migrateOrg(deps, ORG, OPTS)
    expect(second).toMatchObject({ accountsToMigrate: 0, txsToMigrate: 0, rebuildBalanceFixes: 0 }) // `bad` stays skipped
    expect(second.skipped).toEqual([{ kind: 'tx', id: 'bad', reason: 'invalid_amount' }])
    const after = await snapshot()
    for (const path of Object.keys(before)) {
      if (path.includes('/audit/') || path.includes('/rollups/') || path.includes('/ledger/')) continue
      expect(after[path], path).toEqual(before[path])
    }
    expect(await migrations()).toBe(1)
    expect((await verifyLedger(deps, ORG)).balanceDiffs).toEqual([])
  })

  it('the step-4 scenario: an operation written by old code between runs is migrated once, with its balance effect', async () => {
    await db.doc(txPath('bad')).delete()
    await migrateOrg(deps, ORG, OPTS)
    const before = (await readDoc(db, acct('a')))?.balanceMinor as number

    await db.doc(txPath('late')).set({ orgId: ORG, accountId: 'a', type: 'income', amount: 7.25, date: DAY })
    await db.doc(acct('a')).update({ balance: 1234.5 + 7.25 })

    const second = await migrateOrg(deps, ORG, OPTS)
    expect(second).toMatchObject({ accountsToMigrate: 0, txsToMigrate: 1, rebuildBalanceFixes: 0 })
    expect((await readDoc(db, acct('a')))?.balanceMinor).toBe(before + 725)
    expect(await readDoc(db, txPath('late'))).toMatchObject({ schemaVersion: 2, migratedFrom: 'v1', amountMinor: 725 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(await migrations()).toBe(2)

    await migrateOrg(deps, ORG, OPTS)
    expect((await readDoc(db, acct('a')))?.balanceMinor).toBe(before + 725)
  })

  it('resumes after a crash between the operations and the accounts', async () => {
    await db.doc(txPath('bad')).delete()
    await migrateOrg(deps, ORG, OPTS)
    const want = { a: await readDoc(db, acct('a')), e: await readDoc(db, acct('e')) }
    // as if the process died after the operations were written: the accounts are legacy again
    await db.doc(acct('a')).set({ orgId: ORG, name: 'Main', type: 'bank', currency: 'PLN', balance: 1234.5, color: '#112233' })
    await db.doc(acct('e')).set({ orgId: ORG, name: 'Euro', type: 'cash', currency: 'EUR', balance: 10 })

    const report = await migrateOrg(deps, ORG, OPTS)
    expect(report).toMatchObject({ accountsToMigrate: 2, txsToMigrate: 0, rebuildBalanceFixes: 0 })
    expect((await readDoc(db, acct('a')))?.openingMinor).toBe(want.a?.openingMinor)
    expect((await readDoc(db, acct('e')))?.openingMinor).toBe(want.e?.openingMinor)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('moves the balance of an already migrated account once, in the same batch as the operation', async () => {
    await db.doc(txPath('bad')).delete()
    await migrateOrg(deps, ORG, OPTS)
    // `e` is schema 2; old code writes a transfer from legacy-shaped data into it
    await db.doc(txPath('late')).set({ orgId: ORG, accountId: 'a', type: 'transfer', amount: 2, counterpartyId: 'e', date: DAY })
    const e0 = (await readDoc(db, acct('e')))?.balanceMinor as number
    const a0 = (await readDoc(db, acct('a')))?.balanceMinor as number
    await migrateOrg(deps, ORG, OPTS)
    expect((await readDoc(db, acct('e')))?.balanceMinor).toBe(e0 + 200)
    expect((await readDoc(db, acct('a')))?.balanceMinor).toBe(a0 - 200)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('--reset-opening: the account opens at 0 and its balance equals the sum of its operations', async () => {
    await migrateOrg(deps, ORG, { apply: true, resetOpening: new Set(['a']) })
    expect(await readDoc(db, acct('a'))).toMatchObject({ openingMinor: 0, balanceMinor: 122960 })
    expect(await readDoc(db, acct('e'))).toMatchObject({ openingMinor: 200, balanceMinor: 1000 })
  })

  it('stores an operation dated after today with a final rate (capped at today)', async () => {
    const calls: string[] = []
    const capped = makeDeps(db, { resolveRate: fakeResolveRate(calls) })
    await db.doc(txPath('fut')).set({ orgId: ORG, accountId: 'e', type: 'income', amount: 1, date: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')) })
    const report = await migrateOrg(capped, ORG, OPTS)
    expect(report.counters.futureActual).toBe(1)
    expect((await readDoc(db, txPath('fut')))?.fx).toMatchObject({ payment: { requestedDate: '2026-10-27' } })
    expect(calls.every((c) => c.endsWith('@2026-10-20') || c.endsWith('@2026-10-27'))).toBe(true)
  })

  it('writes nothing when a rate cannot be resolved', async () => {
    const before = await snapshot()
    const failing = makeDeps(db, { resolveRate: async () => { throw new Error('nbp down') } })
    await expect(migrateOrg(failing, ORG, OPTS)).rejects.toThrow('nbp down')
    expect(await snapshot()).toEqual(before)
  })

  it('hands the backup to beforeWrite before the first write, and a throw there leaves everything untouched', async () => {
    let seen: { accounts: string[]; txs: string[] } | undefined
    const during = await snapshot()
    await migrateOrg(deps, ORG, {
      ...OPTS,
      beforeWrite: async (r) => {
        expect(await snapshot()).toEqual(during)
        seen = { accounts: r.backup.accounts.map((a) => a.id), txs: r.backup.txs.map((t) => t.id).sort() }
      },
    })
    expect(seen).toEqual({ accounts: ['a', 'e'], txs: ['ei', 'i1', 'i2', 'tr', 'x1'] })

    await seedLegacy()
    const before = await snapshot()
    await expect(
      migrateOrg(deps, ORG, { ...OPTS, beforeWrite: () => { throw new Error('disk full') } }),
    ).rejects.toThrow('disk full')
    expect(await snapshot()).toEqual(before)
  })

  it('throws for a missing company', async () => {
    await expect(migrateOrg(deps, 'nope', DRY)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('dropLegacy', () => {
  async function migrated(): Promise<void> {
    await db.doc(txPath('bad')).delete()
    await migrateOrg(deps, ORG, OPTS)
  }

  it('dry run counts and removes nothing', async () => {
    await migrated()
    const before = await snapshot()
    expect(await dropLegacy(deps, ORG, { apply: false })).toEqual({ applied: false, accounts: 2, transactions: 5 })
    expect(await snapshot()).toEqual(before)
  })

  it('removes balance, date, amount and the transfer counterpartyId on a verified org', async () => {
    await migrated()
    expect(await dropLegacy(deps, ORG, { apply: true })).toEqual({ applied: true, accounts: 2, transactions: 5 })
    for (const id of ['a', 'e']) expect((await readDoc(db, acct(id)))?.balance).toBeUndefined()
    for (const id of ['i1', 'i2', 'x1', 'tr', 'ei']) {
      const data = await readDoc(db, txPath(id))
      expect(data?.date, id).toBeUndefined()
      expect(data?.amount, id).toBeUndefined()
    }
    expect((await readDoc(db, txPath('tr')))?.counterpartyId).toBeUndefined()
    expect(await readDoc(db, txPath('tr'))).toMatchObject({ toAccountId: 'e', amountMinor: 500 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect(await dropLegacy(deps, ORG, { apply: true })).toEqual({ applied: true, accounts: 0, transactions: 0 })
  })

  it('refuses when a balance was tampered with and removes nothing', async () => {
    await migrated()
    await db.doc(acct('a')).update({ balanceMinor: 1 })
    const before = await snapshot()
    expect(await dropLegacy(deps, ORG, { apply: true })).toEqual({ skipped: 'ledger_not_ok' })
    expect(await snapshot()).toEqual(before)
  })

  it('refuses while a legacy operation is left over', async () => {
    await migrateOrg(deps, ORG, OPTS) // `bad` stays legacy
    expect(await dropLegacy(deps, ORG, { apply: true })).toEqual({ skipped: 'ledger_not_ok' })
  })
})
