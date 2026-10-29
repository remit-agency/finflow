import { beforeEach, describe, expect, it } from 'vitest'
import { BACKOFF_MS, runBackgroundSync } from '@/lib/server/banking/background'
import { BankError } from '@/lib/server/banking/errors'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { ORG, clearFirestore, readDoc, seedAccount, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const txCol = () => db.collection(`organizations/${ORG}/transactions`)
const bankDoc = () => readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)

// 2026-10-27 is winter time in Warsaw (UTC+1).
const MORNING = new Date('2026-10-27T10:00:00Z') // 11:00 -> slot 08
const LATE_MORNING = new Date('2026-10-27T11:30:00Z') // 12:30 -> still slot 08
const NOON = new Date('2026-10-27T12:30:00Z') // 13:30 -> slot 13
const EVENING = new Date('2026-10-27T16:30:00Z') // 17:30 -> slot 17
const READY = { firstSyncDone: true, syncedThrough: '2026-10-26' }
const ONE = { '': { transactions: [ebTx('r1', '10.00', 'CRDT', '2026-10-26')], continuationKey: null } }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

describe('slots', () => {
  it('refreshes a linked account once per slot and again in the next slot', async () => {
    await seedBank(db, READY)
    const eb = fakeEb(ONE)
    const first = await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(first).toMatchObject({ slot: '2026-10-27#08', considered: 1, synced: 1, imported: 1, failed: 0, rateLimited: 0 })
    expect(await bankDoc()).toMatchObject({ bgSlot: '2026-10-27#08' })

    const same = await runBackgroundSync(bankDeps(db, eb, LATE_MORNING))
    expect(same).toMatchObject({ slot: '2026-10-27#08', considered: 0, synced: 0 })
    expect(eb.calls).toHaveLength(1)

    const next = await runBackgroundSync(bankDeps(db, eb, NOON))
    expect(next).toMatchObject({ slot: '2026-10-27#13', considered: 1, synced: 1, imported: 0 })
    expect(eb.calls).toHaveLength(2)
    expect((await txCol().get()).size).toBe(1)
  })

  it('takes up to 4 steps (100 new operations) per slot and finishes in the next one', async () => {
    await seedBank(db, READY)
    const txs = Array.from({ length: 110 }, (_, i) => ebTx(`r${i}`, '1.00', 'CRDT', '2026-10-26'))
    const eb = fakeEb({ '': { transactions: txs, continuationKey: null } })
    const deps = bankDeps(db, eb, MORNING)
    expect(await runBackgroundSync(deps)).toMatchObject({ synced: 1, imported: 100 })
    // Each step is one bank request: the first run made 4 of them (one per step, 4 steps per slot).
    expect(eb.calls).toHaveLength(4)
    expect((await txCol().get()).size).toBe(100)
    expect(await bankDoc()).toMatchObject({ bgSlot: '2026-10-27#08', cursor: { startedOn: '2026-10-27' } })

    expect(await runBackgroundSync(bankDeps(db, eb, NOON))).toMatchObject({ synced: 1, imported: 10 })
    // The next slot resumes the cursor with one more request (the 5th) and finishes the account.
    expect(eb.calls).toHaveLength(5)
    expect((await txCol().get()).size).toBe(110)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })
})

describe('the bank limit', () => {
  it('a rate-limit answer sets a 6 hour pause that later runs respect, and the account comes back after it', async () => {
    await seedBank(db, READY)
    const eb = fakeEb(ONE)
    eb.failTransactions = new BankError('rate_limited')
    const hit = await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(hit).toMatchObject({ synced: 0, rateLimited: 1, failed: 0 })
    expect(await bankDoc()).toMatchObject({ bgSlot: '2026-10-27#08', backoffUntil: new Date(MORNING.getTime() + BACKOFF_MS).toISOString() })

    eb.failTransactions = null
    const during = await runBackgroundSync(bankDeps(db, eb, NOON)) // 13:30, inside the pause
    expect(during).toMatchObject({ slot: '2026-10-27#13', considered: 0, synced: 0 })
    expect(eb.calls).toHaveLength(1)

    const after = await runBackgroundSync(bankDeps(db, eb, EVENING)) // the pause ended at 17:00 Warsaw
    expect(after).toMatchObject({ slot: '2026-10-27#17', considered: 1, synced: 1, imported: 1 })
  })

  it('claims the slot before the bank is asked, so a call that never returns cannot be repeated in the same slot', async () => {
    await seedBank(db, READY)
    const eb = fakeEb(ONE)
    const ask = eb.getTransactions
    let claimedWhileAsking: unknown = 'not asked'
    eb.getTransactions = async (uid, q) => {
      claimedWhileAsking = (await bankDoc())?.bgSlot
      return ask(uid, q)
    }
    await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(claimedWhileAsking).toBe('2026-10-27#08')
  })

  it('another bank failure uses the slot without a pause and is counted as failed', async () => {
    await seedBank(db, READY)
    const eb = fakeEb(ONE)
    eb.failTransactions = new BankError('bank_unavailable')
    const r = await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(r).toMatchObject({ synced: 0, failed: 1, rateLimited: 0 })
    const doc = await bankDoc()
    expect(doc).toMatchObject({ bgSlot: '2026-10-27#08' })
    expect(doc?.backoffUntil ?? null).toBeNull()
    expect((await runBackgroundSync(bankDeps(db, eb, LATE_MORNING))).considered).toBe(0)
  })
})

describe('what is left alone', () => {
  it.each([
    ['an account whose first import has not finished', { firstSyncDone: false }, {}],
    ['a disconnected account', { status: 'disconnected' }, {}],
    ['a connection whose access has ended', {}, { validUntil: '2026-10-26T10:00:00.000Z' }],
    ['a connection marked expired', {}, { status: 'expired' }],
  ])('%s', async (_name, over, connection) => {
    await seedBank(db, { ...READY, ...over }, connection)
    const eb = fakeEb(ONE)
    const r = await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(r.synced).toBe(0)
    expect(r.failed).toBe(0)
    expect(eb.calls).toHaveLength(0)
    expect((await bankDoc())?.bgSlot ?? null).toBeNull()
  })

  it('an account that is being synced right now is skipped and the slot stays free', async () => {
    await seedBank(db, { ...READY, syncLock: { until: MORNING.getTime() + 60_000, token: 'other' } })
    const eb = fakeEb(ONE)
    const r = await runBackgroundSync(bankDeps(db, eb, MORNING))
    expect(r).toMatchObject({ considered: 1, synced: 0, skipped: 1, failed: 0 })
    expect(eb.calls).toHaveLength(0)
    expect((await bankDoc())?.bgSlot ?? null).toBeNull()
  })

  it('a busy account keeps the slot value it had before', async () => {
    await seedBank(db, { ...READY, bgSlot: '2026-10-26#17', syncLock: { until: MORNING.getTime() + 60_000, token: 'other' } })
    await runBackgroundSync(bankDeps(db, fakeEb(ONE), MORNING))
    expect(await bankDoc()).toMatchObject({ bgSlot: '2026-10-26#17' })
  })

  it('stops when the time budget is used up and leaves the slot free for the rest', async () => {
    await seedBank(db, READY)
    const eb = fakeEb(ONE)
    const r = await runBackgroundSync(bankDeps(db, eb, MORNING), { budgetMs: 0 })
    expect(r).toMatchObject({ considered: 1, synced: 0, skipped: 1 })
    expect(eb.calls).toHaveLength(0)
    expect((await bankDoc())?.bgSlot ?? null).toBeNull()
  })
})

describe('the time budget inside an account', () => {
  it('a step that starts after the budget ran out is not started; what was imported stays and the account counts as synced', async () => {
    await seedBank(db, READY)
    const txs = Array.from({ length: 110 }, (_, i) => ebTx(`r${i}`, '1.00', 'CRDT', '2026-10-26'))
    const eb = fakeEb({ '': { transactions: txs, continuationKey: null } })
    const ask = eb.getTransactions
    eb.getTransactions = async (uid, q) => {
      const page = await ask(uid, q)
      await new Promise((resolve) => setTimeout(resolve, 60)) // each bank call takes longer than the 50 ms budget
      return page
    }
    const r = await runBackgroundSync(bankDeps(db, eb, MORNING), { budgetMs: 50 })
    expect(r).toMatchObject({ synced: 1, failed: 0, imported: 25 })
    expect(eb.calls).toHaveLength(1)
    expect((await txCol().get()).size).toBe(25)
  })
})
