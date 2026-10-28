import { beforeEach, describe, expect, it } from 'vitest'
import { disconnect, linkAccount, listConnectionAccounts, saveSession } from '@/lib/server/banking/link'
import { ORG, UID, clearFirestore, readDoc, seedAccount, seedOrg, testDb } from './helpers'
import { SESSION, bankDeps, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const eb = fakeEb({})
const deps = bankDeps(db, eb)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  eb.session = SESSION
})

describe('saveSession', () => {
  it('stores the connection with the bank validUntil, active, by the owner', async () => {
    const r = await saveSession(deps, ORG, UID, SESSION)
    expect(r).toEqual({ connectionId: 's1', relinked: 0, unlinked: 1 })
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s1`)).toMatchObject({ sessionId: 's1', institutionName: 'Millennium', validUntil: SESSION.validUntil, status: 'active', connectedBy: UID, orgId: ORG })
  })

  it('a second session of the same bank account re-points the existing link instead of creating another', async () => {
    await seedBank(db)
    await db.doc(`organizations/${ORG}/bankSeen/abc`).set({ txId: 'bk_abc', at: 'x' })
    const next = { ...SESSION, sessionId: 's2', validUntil: '2027-04-21T10:00:00.000Z', accounts: [{ ...SESSION.accounts[0], uid: 'eb-u9' }] }
    const r = await saveSession(deps, ORG, UID, next)
    expect(r).toEqual({ connectionId: 's2', relinked: 1, unlinked: 0 })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ connectionId: 's2', ebAccountUid: 'eb-u9', status: 'active', accountId: 'a1', importFrom: '2026-07-30' })
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s1`)).toBeUndefined() // nothing refers to the old session any more
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/abc`)).toBeDefined()
    expect((await db.collection(`organizations/${ORG}/bankAccounts`).get()).size).toBe(1)
  })

  it('matches when the hash arrays share one hash, even if the first differs', async () => {
    await seedBank(db, { identificationHashes: ['old-a', 'shared'] })
    const next = { ...SESSION, sessionId: 's2', accounts: [{ ...SESSION.accounts[0], identificationHashes: ['new-a', 'shared'], uid: 'eb-u9' }] }
    expect((await saveSession(deps, ORG, UID, next)).relinked).toBe(1)
  })

  it('matches by IBAN when the bank gives no identification hash', async () => {
    await seedBank(db, { identificationHashes: [] })
    const next = { ...SESSION, sessionId: 's2', accounts: [{ ...SESSION.accounts[0], identificationHashes: [], uid: 'eb-u9' }] }
    expect((await saveSession(deps, ORG, UID, next)).relinked).toBe(1)
  })
})

describe('linkAccount', () => {
  beforeEach(async () => {
    await saveSession(deps, ORG, UID, SESSION)
  })

  it('create: makes a PLN bank account with a zero opening balance and the link', async () => {
    const r = await linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' })
    const account = await readDoc(db, `organizations/${ORG}/accounts/${r.accountId}`)
    expect(account).toMatchObject({ name: 'Millennium PLN', type: 'bank', currency: 'PLN', openingMinor: 0, balanceMinor: 0 })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/${r.bankAccountId}`)).toMatchObject({
      connectionId: 's1', ebAccountUid: 'eb-u1', identificationHashes: ['hash-1'], currency: 'PLN', accountId: r.accountId, importFrom: '2026-07-30', status: 'active', firstSyncDone: false, cursor: null, syncLock: null,
    })
  })

  it('existing: links the chosen account; a currency mismatch is refused and nothing is written', async () => {
    await seedAccount(db, ORG, 'a1', 'PLN', 5_000)
    await seedAccount(db, ORG, 'eur', 'EUR', 0)
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'existing', accountId: 'eur', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'currency_mismatch' })
    expect((await db.collection(`organizations/${ORG}/bankAccounts`).get()).size).toBe(0)
    const r = await linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'existing', accountId: 'a1', importFrom: '2026-07-30' })
    expect(r.accountId).toBe('a1')
  })

  it('refuses the same bank account twice and a FinFlow account that already has a bank', async () => {
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
    await linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'existing', accountId: 'a1', importFrom: '2026-07-30' })
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'already_linked' })
    eb.session = { ...SESSION, accounts: [...SESSION.accounts, { uid: 'eb-u2', identificationHashes: ['hash-2'], iban: null, currency: 'PLN', name: null }] }
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u2', mode: 'existing', accountId: 'a1', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'already_linked' })
  })

  it('refuses an unknown connection, an unknown bank account, an unsupported currency, a future start day', async () => {
    await expect(linkAccount(deps, ORG, UID, { connectionId: 'nope', ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'missing', mode: 'create', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'not_found' })
    eb.session = { ...SESSION, accounts: [{ ...SESSION.accounts[0], currency: 'CHF' }] }
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' })).rejects.toMatchObject({ code: 'currency_unsupported' })
    eb.session = SESSION
    await expect(linkAccount(deps, ORG, UID, { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-12-01' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('listConnectionAccounts / disconnect', () => {
  it('flags the accounts that are already linked', async () => {
    await seedBank(db)
    expect((await listConnectionAccounts(deps, ORG, 's1')).accounts).toEqual([{ uid: 'eb-u1', iban: 'PL61109010140000071219812874', currency: 'PLN', name: 'Firmowe', linked: true }])
  })

  it('disconnect removes the connection, keeps the bank accounts (and so the history) and stops syncing them', async () => {
    await seedBank(db, { syncLock: { until: 9e15, token: 't' } })
    await disconnect(deps, ORG, 's1')
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s1`)).toBeUndefined()
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ status: 'disconnected', syncLock: null, accountId: 'a1' })
  })
})
