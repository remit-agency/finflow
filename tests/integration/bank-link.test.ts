import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { disconnect, linkAccount, listConnectionAccounts, saveSession } from '@/lib/server/banking/link'
import { deleteAccount } from '@/lib/server/ledger/accounts'
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

const expectedBankId = (key: string) => `ba_${createHash('sha256').update(`${ORG}:${key}`).digest('hex').slice(0, 24)}`

describe('linking races and the deterministic bank account id', () => {
  beforeEach(async () => {
    await saveSession(deps, ORG, UID, SESSION)
  })

  it('two concurrent links of the same bank account: one succeeds, one is already_linked, one bank account document, one FinFlow account', async () => {
    const input = { connectionId: 's1', ebAccountUid: 'eb-u1', mode: 'create' as const, importFrom: '2026-07-30' }
    const settled = await Promise.allSettled([linkAccount(deps, ORG, UID, input), linkAccount(deps, ORG, UID, input)])
    const ok = settled.filter((s): s is PromiseFulfilledResult<{ bankAccountId: string; accountId: string }> => s.status === 'fulfilled')
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toMatchObject({ code: 'already_linked' })
    expect(ok[0].value.bankAccountId).toBe(expectedBankId('hash-1'))
    expect((await db.collection(`organizations/${ORG}/bankAccounts`).get()).size).toBe(1)
    expect((await db.collection(`organizations/${ORG}/accounts`).where('type', '==', 'bank').get()).size).toBe(1)
  })
})

describe('deleting a FinFlow account that a bank uses', () => {
  it('the ledger refuses to delete an account linked to a bank, in any status', async () => {
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
    await seedBank(db)
    await expect(deleteAccount(deps.ledger, ORG, UID, 'a1')).rejects.toMatchObject({ code: 'account_linked_to_bank' })
    expect(await readDoc(db, `organizations/${ORG}/accounts/a1`)).toBeDefined()
    await db.doc(`organizations/${ORG}/bankAccounts/ba1`).update({ status: 'disconnected' })
    await expect(deleteAccount(deps.ledger, ORG, UID, 'a1')).rejects.toMatchObject({ code: 'account_linked_to_bank' })
  })
})

describe('relinking on renewal', () => {
  it('does not relink a bank account whose currency differs from the session account', async () => {
    await seedBank(db)
    const next = { ...SESSION, sessionId: 's2', accounts: [{ ...SESSION.accounts[0], currency: 'EUR', uid: 'eb-u9' }] }
    expect(await saveSession(deps, ORG, UID, next)).toEqual({ connectionId: 's2', relinked: 0, unlinked: 1 })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ connectionId: 's1', ebAccountUid: 'eb-u1' })
  })

  it('one bank account document is matched by one session account only', async () => {
    await seedBank(db)
    const next = {
      ...SESSION,
      sessionId: 's2',
      accounts: [
        { uid: 'eb-u8', identificationHashes: ['hash-1'], iban: null, currency: 'PLN', name: null },
        { uid: 'eb-u9', identificationHashes: ['hash-1'], iban: null, currency: 'PLN', name: null },
      ],
    }
    expect(await saveSession(deps, ORG, UID, next)).toEqual({ connectionId: 's2', relinked: 1, unlinked: 1 })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ connectionId: 's2', ebAccountUid: 'eb-u8' })
  })

  it('deletes the other connections of the same bank that nothing refers to, and keeps those a bank account still uses', async () => {
    await seedBank(db) // s1, used by ba1
    const conn = (id: string, name: string) => ({ orgId: ORG, sessionId: id, institutionName: name, connectedAt: '2026-09-01T10:00:00.000Z', validUntil: '2026-11-30T10:00:00.000Z', status: 'expired', connectedBy: UID })
    await db.doc(`organizations/${ORG}/bankConnections/old`).set(conn('old', 'Millennium'))
    await db.doc(`organizations/${ORG}/bankConnections/kept`).set(conn('kept', 'Millennium'))
    await db.doc(`organizations/${ORG}/bankConnections/mbank`).set(conn('mbank', 'mBank'))
    await db.doc(`organizations/${ORG}/bankAccounts/ba9`).set({
      orgId: ORG, connectionId: 'kept', ebAccountUid: 'x', identificationHashes: ['zz'], iban: null, currency: 'PLN', accountId: 'a9',
      importFrom: '2026-07-30', status: 'active', lastSyncAt: null, syncedThrough: null, cursor: null, syncLock: null, bankBalance: null, firstSyncDone: false,
    })
    await saveSession(deps, ORG, UID, { ...SESSION, sessionId: 's2', validUntil: '2027-04-21T10:00:00.000Z' })
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/old`)).toBeUndefined()
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s1`)).toBeUndefined()
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/kept`)).toBeDefined()
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/mbank`)).toBeDefined()
    expect(await readDoc(db, `organizations/${ORG}/bankConnections/s2`)).toBeDefined()
  })

  it('relinking re-activates a disconnected bank account and resets its cursor and lock', async () => {
    await seedBank(db, {
      status: 'disconnected',
      cursor: { from: '2026-07-30', continuationKey: 'p2', startedOn: '2026-10-26' },
      syncLock: { until: 9e15, token: 't' },
    })
    await saveSession(deps, ORG, UID, { ...SESSION, sessionId: 's2', validUntil: '2027-04-21T10:00:00.000Z' })
    expect(await readDoc(db, `organizations/${ORG}/bankAccounts/ba1`)).toMatchObject({ status: 'active', cursor: null, syncLock: null, connectionId: 's2', accountId: 'a1' })
  })
})
