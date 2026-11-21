import { createHash } from 'node:crypto'
import { Timestamp, type CollectionReference, type Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { membershipsQuery } from '@/lib/server/orgs'
import { EraseError, executeOrgErase, executeUserErase, planOrgErase, planUserErase, type EraseDeps } from '@/scripts/lib/erase'
import { clearFirestore, readDoc, testDb } from './helpers'

const db = testDb()
const NOW = new Date('2026-11-21T10:00:00Z')
const ORG = 'erase-org'
const OWNER = 'owner-uid'
const ACCOUNTANT = 'acc-uid'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

interface Fakes {
  deps: EraseDeps
  revoked: string[]
  deleted: string[]
}

function fakes(options: { failRevoke?: string[]; users?: Record<string, string> } = {}): Fakes {
  const revoked: string[] = []
  const deleted: string[] = []
  const users = options.users ?? {}
  const deps: EraseDeps = {
    db,
    now: () => NOW,
    auth: {
      async getUserByEmail(email) {
        const uid = users[email]
        if (!uid) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
        return { uid }
      },
      async deleteUser(uid) {
        deleted.push(uid)
      },
    },
    async revokeBankSession(sessionId) {
      if (options.failRevoke?.includes(sessionId)) throw new Error('bank down')
      revoked.push(sessionId)
    },
  }
  return { deps, revoked, deleted }
}

async function seedMember(orgId: string, uid: string, role: string): Promise<void> {
  await db.doc(`organizations/${orgId}/members/${uid}`).set({ uid, role, addedBy: OWNER })
}

/** A company with one document in each kind of subcollection it can hold. */
async function seedFullOrg(orgId = ORG): Promise<void> {
  await db.doc(`organizations/${orgId}`).set({ name: 'Acme sp. z o.o.', email: 'boss@acme.test', currency: 'PLN', ownerId: OWNER, plan: 'trial' })
  await seedMember(orgId, OWNER, 'owner')
  await seedMember(orgId, ACCOUNTANT, 'accountant')
  const docs: Record<string, Record<string, unknown>> = {
    'accounts/a1': { name: 'Bank', currency: 'PLN' },
    'accounts/a2': { name: 'Cash', currency: 'PLN' },
    'transactions/t1': { amountMinor: 100 },
    'transactions/t2': { amountMinor: 200 },
    'transactions/t3': { amountMinor: 300 },
    'categories/c1': { name: 'Food' },
    'bankConnections/s1': { sessionId: 's1', connectedAt: '2026-11-01T00:00:00Z', connectedBy: OWNER },
    'bankConnections/s2': { sessionId: 's2', connectedAt: '2026-11-01T00:00:00Z' },
    'bankAccounts/ba1': { connectionId: 's1' },
    'bankSeen/x1': { at: 1 },
    'audit/au1': { uid: OWNER, action: 'tx.create' },
    'rollups/r1': { total: 1 },
    'ledger/lock': { holder: null },
    'importLocks/a1': { at: 1 },
    'imports/i1': { status: 'done' },
  }
  for (const [path, data] of Object.entries(docs)) await db.doc(`organizations/${orgId}/${path}`).set(data)
}

/** Every document path under the root collections the tests use, with its data: proves "changes nothing". */
async function snapshot(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  async function walk(ref: CollectionReference): Promise<void> {
    for (const d of (await ref.get()).docs) out[d.ref.path] = d.data()
    for (const d of await ref.listDocuments()) for (const sub of await d.listCollections()) await walk(sub)
  }
  for (const c of await db.listCollections()) await walk(c)
  return out
}

async function erasureLog(fs: Firestore): Promise<Record<string, unknown>[]> {
  return (await fs.collection('_meta').doc('erasures').collection('log').get()).docs.map((d) => d.data())
}

beforeEach(async () => {
  await clearFirestore()
})

describe('planOrgErase', () => {
  it('counts every subcollection and changes nothing', async () => {
    await seedFullOrg()
    const { deps, revoked } = fakes()
    const before = await snapshot()
    const plan = await planOrgErase(deps, ORG)
    expect(await snapshot()).toEqual(before)
    expect(revoked).toEqual([])
    expect(plan).toEqual({
      orgId: ORG,
      collections: {
        accounts: 2, transactions: 3, categories: 1, members: 2, bankConnections: 2, bankAccounts: 1, bankSeen: 1,
        audit: 1, rollups: 1, ledger: 1, importLocks: 1, imports: 1,
      },
      bankSessions: ['s1', 's2'],
      unreadableBankConnections: 0,
      members: 2,
    })
  })

  it('a missing company is not_found', async () => {
    await expect(planOrgErase(fakes().deps, 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('executeOrgErase', () => {
  it('revokes the bank sessions, deletes the company with every subcollection and logs a count-only entry', async () => {
    await seedFullOrg()
    await seedFullOrg('other-org')
    const { deps, revoked } = fakes()
    const result = await executeOrgErase(deps, ORG, { skipBankRevoke: false })

    expect(revoked.sort()).toEqual(['s1', 's2'])
    expect(result.revoked).toBe(2)
    expect(result.counts).toMatchObject({ transactions: 3, members: 2, bankConnections: 2, audit: 1, ledger: 1, importLocks: 1 })
    expect(await readDoc(db, `organizations/${ORG}`)).toBeUndefined()
    expect(await db.doc(`organizations/${ORG}`).listCollections()).toEqual([])
    // The membership lookup (collection group `members` by uid) no longer finds the erased company.
    const memberships = (await membershipsQuery(db, ACCOUNTANT).get()).docs.map((d) => d.ref.parent.parent?.id)
    expect(memberships).toEqual(['other-org'])
    // The other company is untouched.
    expect((await db.collection('organizations/other-org/transactions').get()).size).toBe(3)

    const log = await erasureLog(db)
    expect(log).toHaveLength(1)
    expect(log[0]).toEqual({ kind: 'org', idHash: sha256(ORG), at: Timestamp.fromDate(NOW), counts: result.counts })
    const text = JSON.stringify(log[0])
    for (const secret of ['Acme', 'boss@acme.test', ORG, OWNER, 's1']) expect(text).not.toContain(secret)
  })

  it('a failing bank revocation throws bank_revoke_failed and deletes nothing', async () => {
    await seedFullOrg()
    const before = await snapshot()
    const { deps } = fakes({ failRevoke: ['s2'] })
    const err = await executeOrgErase(deps, ORG, { skipBankRevoke: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EraseError)
    expect(err).toMatchObject({ code: 'bank_revoke_failed', detail: 1 })
    expect(await snapshot()).toEqual(before)
  })

  it('a connection without a readable session id refuses unless --skip-bank-revoke', async () => {
    await seedFullOrg()
    await db.doc(`organizations/${ORG}/bankConnections/broken`).set({ connectedAt: 'x' })
    const before = await snapshot()
    const { deps, revoked } = fakes()
    await expect(executeOrgErase(deps, ORG, { skipBankRevoke: false })).rejects.toMatchObject({ code: 'bank_revoke_failed', detail: 1 })
    expect(revoked).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('with skipBankRevoke it deletes without calling the bank', async () => {
    await seedFullOrg()
    const { deps, revoked } = fakes({ failRevoke: ['s1', 's2'] })
    const result = await executeOrgErase(deps, ORG, { skipBankRevoke: true })
    expect(result.revoked).toBe(0)
    expect(revoked).toEqual([])
    expect(await readDoc(db, `organizations/${ORG}`)).toBeUndefined()
    expect(await erasureLog(db)).toHaveLength(1)
  })

  it('a missing company throws not_found and logs nothing', async () => {
    const err = await executeOrgErase(fakes().deps, 'nope', { skipBankRevoke: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EraseError)
    expect(err).toMatchObject({ code: 'not_found' })
    expect(await erasureLog(db)).toEqual([])
  })
})

describe('planUserErase / executeUserErase', () => {
  it('reports the companies the user is the only owner of', async () => {
    await seedFullOrg()
    await db.doc('organizations/shared').set({ name: 'Shared' })
    await seedMember('shared', OWNER, 'owner')
    await seedMember('shared', 'co-owner', 'owner')
    const plan = await planUserErase(fakes().deps, { uid: OWNER })
    expect(plan).toMatchObject({
      uid: OWNER,
      memberships: [{ orgId: ORG, role: 'owner' }, { orgId: 'shared', role: 'owner' }],
      soleOwnerOf: [ORG],
    })
  })

  it('resolves an email through Auth, and an unknown email is not_found', async () => {
    await seedFullOrg()
    const { deps } = fakes({ users: { 'acc@x.test': ACCOUNTANT } })
    expect((await planUserErase(deps, { email: 'acc@x.test' })).uid).toBe(ACCOUNTANT)
    await expect(planUserErase(deps, { email: 'nobody@x.test' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a sole owner and changes nothing (no Auth deletion, no Firestore deletion)', async () => {
    await seedFullOrg()
    await db.doc(`userConsents/${OWNER}`).set({ terms: { version: '1' } })
    await db.doc(`userConsents/${OWNER}/events/e1`).set({ doc: 'terms' })
    const before = await snapshot()
    const { deps, deleted } = fakes()
    const err = await executeUserErase(deps, { uid: OWNER }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EraseError)
    expect(err).toMatchObject({ code: 'sole_owner', detail: [ORG] })
    expect(deleted).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('erases an accountant of two companies: memberships, consents with events, Auth user, count-only log', async () => {
    await seedFullOrg()
    await seedFullOrg('org-b')
    await db.doc(`userConsents/${ACCOUNTANT}`).set({ terms: { version: '1' }, privacy: { version: '1' } })
    await db.doc(`userConsents/${ACCOUNTANT}/events/e1`).set({ doc: 'terms' })
    await db.doc(`userConsents/${ACCOUNTANT}/events/e2`).set({ doc: 'privacy' })
    await db.doc(`userConsents/${OWNER}`).set({ terms: { version: '1' } })
    // Audit entries written by the accountant: one with only the uid (company history, stays as it is) and one that
    // also carries an email and a name (must be scrubbed of them).
    await db.doc(`organizations/${ORG}/audit/plain`).set({ uid: ACCOUNTANT, action: 'tx.update', targetId: 't1' })
    await db.doc(`organizations/org-b/audit/named`).set({ uid: ACCOUNTANT, action: 'tx.create', targetId: 't2', email: 'acc@x.test', name: 'Anna Accountant' })

    const { deps, deleted } = fakes({ users: { 'acc@x.test': ACCOUNTANT } })
    const plan = await planUserErase(deps, { email: 'acc@x.test' })
    expect(plan).toMatchObject({ uid: ACCOUNTANT, memberships: [{ orgId: ORG, role: 'accountant' }, { orgId: 'org-b', role: 'accountant' }], soleOwnerOf: [], consentDocs: 3, auditToScrub: 1 })

    const result = await executeUserErase(deps, { email: 'acc@x.test' })
    expect(result.counts).toEqual({ memberships: 2, consentDocs: 3, auditScrubbed: 1 })
    expect(deleted).toEqual([ACCOUNTANT])
    expect(await readDoc(db, `organizations/${ORG}/members/${ACCOUNTANT}`)).toBeUndefined()
    expect(await readDoc(db, `organizations/org-b/members/${ACCOUNTANT}`)).toBeUndefined()
    expect((await membershipsQuery(db, ACCOUNTANT).get()).empty).toBe(true)
    expect(await readDoc(db, `userConsents/${ACCOUNTANT}`)).toBeUndefined()
    expect((await db.collection(`userConsents/${ACCOUNTANT}/events`).get()).empty).toBe(true)
    // Nothing else is touched: the owner's membership and consents, the companies themselves.
    expect(await readDoc(db, `organizations/${ORG}/members/${OWNER}`)).toBeDefined()
    expect(await readDoc(db, `userConsents/${OWNER}`)).toBeDefined()
    expect(await readDoc(db, `organizations/${ORG}`)).toBeDefined()

    expect(await readDoc(db, `organizations/${ORG}/audit/plain`)).toEqual({ uid: ACCOUNTANT, action: 'tx.update', targetId: 't1' })
    expect(await readDoc(db, `organizations/org-b/audit/named`)).toEqual({ uid: ACCOUNTANT, action: 'tx.create', targetId: 't2' })

    const log = await erasureLog(db)
    expect(log).toEqual([{ kind: 'user', idHash: sha256(ACCOUNTANT), at: Timestamp.fromDate(NOW), counts: result.counts }])
    const text = JSON.stringify(log[0])
    for (const secret of [ACCOUNTANT, 'acc@x.test', 'Anna']) expect(text).not.toContain(secret)
  })

  it('erasing the company first lets its sole owner be erased afterwards', async () => {
    await seedFullOrg()
    const { deps, deleted } = fakes()
    await expect(executeUserErase(deps, { uid: OWNER })).rejects.toMatchObject({ code: 'sole_owner' })
    await executeOrgErase(deps, ORG, { skipBankRevoke: true })
    const result = await executeUserErase(deps, { uid: OWNER })
    expect(result.counts).toEqual({ memberships: 0, consentDocs: 0, auditScrubbed: 0 })
    expect(deleted).toEqual([OWNER])
    expect((await erasureLog(db)).map((e) => e.kind).sort()).toEqual(['org', 'user'])
  })
})
