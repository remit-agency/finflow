import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_NEW_PER_STEP, syncStep } from '@/lib/server/banking/sync'
import { BankError } from '@/lib/server/banking/errors'
import { bankTxKeys } from '@/lib/server/banking/key'
import { mapBankTransaction } from '@/lib/domain/banking/map'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { createTransaction, deleteTransaction } from '@/lib/server/ledger/write'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { ORG, UID, balanceOf, clearFirestore, readDoc, seedAccount, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const txCol = () => db.collection(`organizations/${ORG}/transactions`)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

async function runToEnd(deps: ReturnType<typeof bankDeps>, max = 20) {
  const results = []
  for (let i = 0; i < max; i++) {
    const r = await syncStep(deps, ORG, UID, 'ba1')
    results.push(r)
    if (r.done) return results
  }
  throw new Error('sync did not finish')
}

describe('first sync', () => {
  it('imports every page, fits the opening balance to the bank, and leaves a consistent ledger', async () => {
    await seedBank(db)
    const eb = fakeEb({
      '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '40.00', 'DBIT', '2026-10-21')], continuationKey: 'p2' },
      p2: { transactions: [ebTx('r3', '10.00', 'DBIT', '2026-10-22')], continuationKey: null },
    }, '1000.00')
    const deps = bankDeps(db, eb)
    const results = await runToEnd(deps)
    expect(results.map((r) => [r.imported, r.done])).toEqual([[2, false], [1, true]])
    expect(results.at(-1)).toMatchObject({ bankBalanceMinor: 100_000, differenceMinor: 0 })
    expect(await balanceOf(db, ORG, 'a1')).toBe(100_000) // opening was fitted: 1000.00 - (100 - 40 - 10)
    expect(await readDoc(db, `organizations/${ORG}/accounts/a1`)).toMatchObject({ openingMinor: 95_000 })
    expect((await txCol().get()).size).toBe(3)
    const first = (await txCol().where('bank.entryReference', '==', 'r1').get()).docs[0]
    expect(first.data()).toMatchObject({ source: 'bank', type: 'income', status: 'actual', amountMinor: 10_000, paymentDate: '2026-10-20', accountId: 'a1' })
    expect(first.id).toMatch(/^bk_[0-9a-f]{32}$/)
    expect((await db.collection(`organizations/${ORG}/bankSeen`).get()).size).toBe(3)
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ firstSyncDone: true, cursor: null, syncLock: null, syncedThrough: '2026-10-27', bankBalance: { amountMinor: 100_000, type: 'CLBD' } })
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
    expect(eb.calls[0]).toMatchObject({ uid: 'eb-u1', dateFrom: '2026-07-30', continuationKey: null })
    expect(eb.calls[1].continuationKey).toBe('p2')
  })

  it('counts manual operations already on the account when it fits the opening balance', async () => {
    await seedBank(db)
    await db.doc(`organizations/${ORG}/accounts/a1`).update({ openingMinor: 7_000, balanceMinor: 7_000 })
    const eb = fakeEb({ '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null } }, '500.00')
    await runToEnd(bankDeps(db, eb))
    expect(await balanceOf(db, ORG, 'a1')).toBe(50_000)
  })
})

describe('later syncs', () => {
  it('a repeated sync imports nothing, asks the bank again from syncedThrough minus 3 days, and never duplicates', async () => {
    await seedBank(db)
    const page = { '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null } }
    await runToEnd(bankDeps(db, fakeEb(page, '100.00')))
    const eb = fakeEb({ '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '5.00', 'DBIT', '2026-10-26')], continuationKey: null } }, '95.00')
    const results = await runToEnd(bankDeps(db, eb, new Date('2026-10-28T10:00:00Z')))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ imported: 1, skipped: 1, done: true, differenceMinor: 0 })
    expect(eb.calls[0].dateFrom).toBe('2026-10-24') // syncedThrough 2026-10-27 minus 3 days
    expect((await txCol().get()).size).toBe(2)
  })

  it('an operation the person deleted is not brought back, and the difference to the bank shows', async () => {
    await seedBank(db)
    const eb = fakeEb({ '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '30.00', 'DBIT', '2026-10-21')], continuationKey: null } }, '70.00')
    const deps = bankDeps(db, eb)
    await runToEnd(deps)
    const victim = (await txCol().where('bank.entryReference', '==', 'r2').get()).docs[0]
    await deleteTransaction(deps.ledger, ORG, UID, victim.id)
    const again = await runToEnd(deps)
    expect(again[0]).toMatchObject({ imported: 0, skipped: 2, differenceMinor: 3_000 })
    expect((await txCol().get()).size).toBe(1)
  })

  it('two identical operations without a bank reference both arrive, once', async () => {
    await seedBank(db)
    const twin = ebTx(null, '12.00', 'DBIT', '2026-10-20', { remittance_information: ['Kawa'] })
    const page = { '': { transactions: [twin, { ...twin }], continuationKey: null } }
    const deps = bankDeps(db, fakeEb(page, '-24.00'))
    await runToEnd(deps)
    await runToEnd(deps)
    expect((await txCol().get()).size).toBe(2)
  })
})

describe('limits and safety', () => {
  it(`takes at most ${MAX_NEW_PER_STEP} new operations per step and continues on the next call`, async () => {
    await seedBank(db)
    const txs = Array.from({ length: MAX_NEW_PER_STEP + 5 }, (_, i) => ebTx(`r${i}`, '1.00', 'CRDT', '2026-10-20'))
    const deps = bankDeps(db, fakeEb({ '': { transactions: txs, continuationKey: null } }, '30.00'))
    const results = await runToEnd(deps)
    expect(results.map((r) => [r.imported, r.done])).toEqual([[MAX_NEW_PER_STEP, false], [5, true]])
    expect((await txCol().get()).size).toBe(MAX_NEW_PER_STEP + 5)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('refuses while another step holds the lock, and takes over an expired lock', async () => {
    await seedBank(db, { syncLock: { until: new Date('2026-10-27T10:00:30Z').getTime(), token: 'other' } })
    const deps = bankDeps(db, fakeEb({}, '0.00'))
    await expect(syncStep(deps, ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'already_running' })
    await db.doc(`organizations/${ORG}/bankAccounts/ba1`).update({ syncLock: { until: new Date('2026-10-27T09:00:00Z').getTime(), token: 'old' } })
    await expect(syncStep(deps, ORG, UID, 'ba1')).resolves.toMatchObject({ done: true })
  })

  it('an operation that cannot be a ledger operation is marked seen and does not stop the rest; a pending one is ignored without a mark', async () => {
    await seedBank(db)
    const eur = ebTx('r-eur', '5.00', 'CRDT', '2026-10-20', { transaction_amount: { amount: '5.00', currency: 'EUR' } })
    const pending = ebTx('r-pending', '9.00', 'CRDT', '2026-10-20', { status: 'PDNG' })
    const ok = ebTx('r-ok', '7.00', 'CRDT', '2026-10-20')
    const deps = bankDeps(db, fakeEb({ '': { transactions: [eur, pending, ok], continuationKey: null } }, '7.00'))
    const r = (await runToEnd(deps))[0]
    expect(r).toMatchObject({ imported: 1, failed: 1, skipped: 1 })
    const seen = await db.collection(`organizations/${ORG}/bankSeen`).get()
    const reasons = seen.docs.map((d) => d.get('reason') as string | undefined)
    expect(seen.size).toBe(2)
    expect(reasons.filter((reason) => reason !== undefined)).toEqual(['currency'])
  })

  it('a bank that says the consent is gone marks the connection expired; an expired validUntil does the same before any call', async () => {
    await seedBank(db)
    const eb = fakeEb({})
    eb.failTransactions = new BankError('consent_expired')
    await expect(syncStep(bankDeps(db, eb), ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'consent_expired' })
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s1`)).toMatchObject({ status: 'expired' })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ syncLock: null })

    await clearFirestore()
    await seedOrg(db)
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
    await seedBank(db, {}, { validUntil: '2026-10-20T10:00:00.000Z' })
    const quiet = fakeEb({})
    await expect(syncStep(bankDeps(db, quiet), ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'consent_expired' })
    expect(quiet.calls).toHaveLength(0)
  })

  it('a disconnected or unknown bank account is not found', async () => {
    await seedBank(db, { status: 'disconnected' })
    await expect(syncStep(bankDeps(db, fakeEb({})), ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'not_found' })
    await expect(syncStep(bankDeps(db, fakeEb({})), ORG, UID, 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})

const seenCount = async () => (await db.collection(`organizations/${ORG}/bankSeen`).get()).size
const cursorOf = async () => (await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`))?.cursor

describe('a ledger refusal that retrying can fix does not drop the operation', () => {
  it('a busy ledger aborts the step: nothing is marked, the cursor stays, and a later step imports everything once', async () => {
    await seedBank(db)
    // The busy error hits the first create of a page that is not the last one, so a step that swallowed it would move on.
    const eb = fakeEb({
      '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '40.00', 'DBIT', '2026-10-21')], continuationKey: 'p2' },
      p2: { transactions: [ebTx('r3', '10.00', 'DBIT', '2026-10-22')], continuationKey: null },
    }, '50.00')
    const deps = bankDeps(db, eb)
    const token = await acquireLock(deps.ledger, ORG, 'test')
    await expect(syncStep(deps, ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'ledger_busy' })
    expect(await seenCount()).toBe(0)
    expect(await cursorOf()).toBeNull()
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ syncLock: null })
    await releaseLock(deps.ledger, ORG, token)

    const results = await runToEnd(deps)
    expect(results.reduce((n, r) => n + r.imported, 0)).toBe(3)
    expect((await txCol().get()).size).toBe(3)
    expect(await seenCount()).toBe(3)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('a run that fails on page 2 resumes from page 2: page 1 stays, nothing is lost or doubled', async () => {
    await seedBank(db)
    const eb = fakeEb({
      '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '40.00', 'DBIT', '2026-10-21')], continuationKey: 'p2' },
      p2: { transactions: [ebTx('r3', '10.00', 'DBIT', '2026-10-22'), ebTx('r4', '1.00', 'CRDT', '2026-10-23')], continuationKey: 'p3' },
      p3: { transactions: [ebTx('r5', '1.00', 'CRDT', '2026-10-24')], continuationKey: null },
    }, '52.00')
    const deps = bankDeps(db, eb)
    expect(await syncStep(deps, ORG, UID, 'ba1')).toMatchObject({ imported: 2, done: false })
    expect(await cursorOf()).toMatchObject({ continuationKey: 'p2' })

    const token = await acquireLock(deps.ledger, ORG, 'test')
    await expect(syncStep(deps, ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'ledger_busy' })
    expect(await cursorOf()).toMatchObject({ continuationKey: 'p2', startedOn: '2026-10-27' })
    await releaseLock(deps.ledger, ORG, token)

    const rest = await runToEnd(deps)
    expect(rest.reduce((n, r) => n + r.imported, 0)).toBe(3)
    expect(eb.calls.map((c) => c.continuationKey)).toEqual([null, 'p2', 'p2', 'p3'])
    expect((await txCol().get()).size).toBe(5)
    expect(await seenCount()).toBe(5)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('a booking dated after today is skipped without a mark and arrives on a later sync', async () => {
    await seedBank(db)
    const eb = fakeEb({ '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20'), ebTx('r2', '5.00', 'DBIT', '2026-10-29')], continuationKey: null } }, '95.00')
    const deps = bankDeps(db, eb)
    const first = await runToEnd(deps)
    expect(first[0]).toMatchObject({ imported: 1, skipped: 1, failed: 0 })
    expect(await seenCount()).toBe(1)

    const later = bankDeps(db, eb, new Date('2026-10-29T10:00:00Z'))
    const laterDeps = { ...later, today: () => '2026-10-29', ledger: { ...later.ledger, today: () => '2026-10-29' } }
    const second = await runToEnd(laterDeps)
    expect(second[0]).toMatchObject({ imported: 1, skipped: 1, failed: 0 })
    expect((await txCol().get()).size).toBe(2)
  })

  it('an amount beyond the ledger limit is a permanent refusal: marked with its reason, and the rest goes on', async () => {
    await seedBank(db)
    const huge = ebTx('r-huge', '100000000000.01', 'CRDT', '2026-10-20')
    const ok = ebTx('r-ok', '7.00', 'CRDT', '2026-10-20')
    const deps = bankDeps(db, fakeEb({ '': { transactions: [huge, ok], continuationKey: null } }, '7.00'))
    const r = (await runToEnd(deps))[0]
    expect(r).toMatchObject({ imported: 1, failed: 1 })
    const reasons = (await db.collection(`organizations/${ORG}/bankSeen`).get()).docs.map((d) => d.get('reason') as string | undefined)
    expect(reasons.filter((x) => x !== undefined)).toEqual(['invalid_input'])
  })
})

describe('the linked FinFlow account and the cursor', () => {
  it('a FinFlow account that no longer exists stops the step before the bank is asked, and the lock is released', async () => {
    await seedBank(db, { accountId: 'gone' })
    const eb = fakeEb({})
    await expect(syncStep(bankDeps(db, eb), ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'not_found' })
    expect(eb.calls).toHaveLength(0)
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ syncLock: null })
  })

  it('a FinFlow account in another currency stops the step before the bank is asked', async () => {
    await seedAccount(db, ORG, 'eur', 'EUR', 0)
    await seedBank(db, { accountId: 'eur' })
    const eb = fakeEb({})
    await expect(syncStep(bankDeps(db, eb), ORG, UID, 'ba1')).rejects.toMatchObject({ code: 'currency_mismatch' })
    expect(eb.calls).toHaveLength(0)
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ syncLock: null })
  })

  it('a cursor saved on an earlier day is not resumed: the run starts again from the first page', async () => {
    await seedBank(db, { cursor: { from: '2026-07-30', continuationKey: 'stale', startedOn: '2026-10-26' } })
    const eb = fakeEb({
      '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null },
      stale: { transactions: [], continuationKey: null },
    }, '100.00')
    const result = await syncStep(bankDeps(db, eb), ORG, UID, 'ba1')
    expect(result).toMatchObject({ imported: 1, done: true })
    expect(eb.calls[0].continuationKey).toBeNull()
  })

  it('a cursor saved today is resumed', async () => {
    await seedBank(db, { cursor: { from: '2026-07-30', continuationKey: 'p2', startedOn: '2026-10-27' } })
    const eb = fakeEb({ p2: { transactions: [ebTx('r2', '5.00', 'DBIT', '2026-10-21')], continuationKey: null } }, '95.00')
    await syncStep(bankDeps(db, eb), ORG, UID, 'ba1')
    expect(eb.calls[0].continuationKey).toBe('p2')
  })
})

describe('pages, parallel steps and a crash between the write and the mark', () => {
  it(`two pages at ${MAX_NEW_PER_STEP} per step: the first step does not move the continuation key, the second finishes page 1, every operation exists once`, async () => {
    await seedBank(db)
    const page1 = Array.from({ length: MAX_NEW_PER_STEP + 5 }, (_, i) => ebTx(`p1-${i}`, '1.00', 'CRDT', '2026-10-20'))
    const page2 = Array.from({ length: 5 }, (_, i) => ebTx(`p2-${i}`, '1.00', 'CRDT', '2026-10-21'))
    const eb = fakeEb({
      '': { transactions: page1, continuationKey: 'p2' },
      p2: { transactions: page2, continuationKey: null },
    }, '35.00')
    const deps = bankDeps(db, eb)
    expect(await syncStep(deps, ORG, UID, 'ba1')).toMatchObject({ imported: MAX_NEW_PER_STEP, done: false })
    expect(await cursorOf()).toMatchObject({ continuationKey: null })
    expect(await syncStep(deps, ORG, UID, 'ba1')).toMatchObject({ imported: 5, skipped: MAX_NEW_PER_STEP, done: false })
    expect(await cursorOf()).toMatchObject({ continuationKey: 'p2' })
    expect(await syncStep(deps, ORG, UID, 'ba1')).toMatchObject({ imported: 5, done: true })
    expect(eb.calls.map((c) => c.continuationKey)).toEqual([null, null, 'p2'])
    const docs = (await txCol().get()).docs
    expect(docs).toHaveLength(MAX_NEW_PER_STEP + 10)
    expect(new Set(docs.map((d) => d.id)).size).toBe(MAX_NEW_PER_STEP + 10)
    expect(await seenCount()).toBe(MAX_NEW_PER_STEP + 10)
  })

  it('heals a crash between the write and the mark: the operation is not written twice and the mark appears', async () => {
    await seedBank(db)
    const tx = ebTx('r1', '100.00', 'CRDT', '2026-10-20')
    const [{ key }] = bankTxKeys('ba1', [tx])
    const mapped = mapBankTransaction(tx, { bankAccountId: 'ba1', accountId: 'a1', accountCurrency: 'PLN', clientId: `bk_${key}` })
    if (!mapped.ok) throw new Error('the fixture must map')
    await createTransaction(bankDeps(db, fakeEb({})).ledger, ORG, UID, parseTransactionInput(mapped.input, { internal: true }), mapped.bank)
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${key}`)).toBeUndefined()

    const deps = bankDeps(db, fakeEb({ '': { transactions: [tx], continuationKey: null } }, '100.00'))
    const results = await runToEnd(deps)
    expect(results[0]).toMatchObject({ imported: 0, skipped: 1 })
    expect((await txCol().get()).size).toBe(1)
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${key}`)).toMatchObject({ txId: `bk_${key}` })
  })

  it('two steps at the same time: one runs, the other answers already_running', async () => {
    await seedBank(db)
    const eb = fakeEb({ '': { transactions: [ebTx('r1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null } }, '100.00')
    // The bank call of the first step waits, so the second step certainly starts while the lock is held.
    const original = eb.getTransactions.bind(eb)
    eb.getTransactions = async (uid, q) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return original(uid, q)
    }
    const deps = bankDeps(db, eb)
    const settled = await Promise.allSettled([syncStep(deps, ORG, UID, 'ba1'), syncStep(deps, ORG, UID, 'ba1')])
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'already_running' })
    expect((await txCol().get()).size).toBe(1)
  })
})
