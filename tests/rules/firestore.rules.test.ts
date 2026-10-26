import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'

const PROJECT_ID = 'demo-finflow'
// FIRESTORE_RULES_FILE lets the "red" check run this suite against a deliberately open ruleset.
const RULES_FILE = process.env.FIRESTORE_RULES_FILE ?? resolve(process.cwd(), 'firestore.rules')
const DAY = 24 * 60 * 60 * 1000
const DATA_SUBS = ['accounts', 'categories', 'transactions'] as const
const ALL_SUBS = [...DATA_SUBS, 'bankConnections'] as const

let testEnv: RulesTestEnvironment

// RulesTestContext.firestore() is typed as the compat SDK; the modular API accepts it at runtime.
function fs(ctx: RulesTestContext): Firestore {
  return ctx.firestore() as unknown as Firestore
}
const anon = () => fs(testEnv.unauthenticatedContext())
const as = (uid: string) => fs(testEnv.authenticatedContext(uid))

// Fixture users:
//   alice  owner of orgA            carol  accountant in orgA, viewer in orgB
//   dave   viewer in orgA           bob    owner of orgB
//   frank  has a member doc in orgA with an unknown role ('admin')
//   erin   no membership anywhere
const ROLE_USERS = [
  { role: 'owner', uid: 'alice', dataRead: true, dataWrite: true, bank: true },
  { role: 'accountant', uid: 'carol', dataRead: true, dataWrite: true, bank: false },
  { role: 'viewer', uid: 'dave', dataRead: true, dataWrite: false, bank: false },
] as const

function orgDoc(ownerId: string) {
  return {
    name: `${ownerId} org`,
    currency: 'UAH',
    ownerId,
    plan: 'trial',
    trialEndsAt: Timestamp.fromMillis(Date.now() + 14 * DAY),
    createdAt: Timestamp.now(),
  }
}

function memberDoc(uid: string, role: string) {
  return { uid, role, createdAt: Timestamp.now(), addedBy: 'alice' }
}

// Succeeds or fails the operation, depending on what the role may do.
const expectOutcome = (allowed: boolean, op: Promise<unknown>) => (allowed ? assertSucceeds(op) : assertFails(op))

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES_FILE, 'utf8') },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = fs(ctx)
    await setDoc(doc(db, 'organizations/orgA'), orgDoc('alice'))
    await setDoc(doc(db, 'organizations/orgB'), orgDoc('bob'))
    await setDoc(doc(db, 'organizations/orgA/members/alice'), memberDoc('alice', 'owner'))
    await setDoc(doc(db, 'organizations/orgA/members/carol'), memberDoc('carol', 'accountant'))
    await setDoc(doc(db, 'organizations/orgA/members/dave'), memberDoc('dave', 'viewer'))
    await setDoc(doc(db, 'organizations/orgA/members/frank'), memberDoc('frank', 'admin'))
    await setDoc(doc(db, 'organizations/orgB/members/bob'), memberDoc('bob', 'owner'))
    await setDoc(doc(db, 'organizations/orgB/members/carol'), memberDoc('carol', 'viewer'))
    for (const orgId of ['orgA', 'orgB']) {
      for (const sub of ALL_SUBS) {
        await setDoc(doc(db, `organizations/${orgId}/${sub}/seed`), { orgId, name: 'seed' })
      }
    }
    await setDoc(doc(db, '_meta/health'), { ok: true })
  })
})

describe('anonymous user', () => {
  it('cannot read anything', async () => {
    await assertFails(getDoc(doc(anon(), 'organizations/orgA')))
    await assertFails(getDocs(collection(anon(), 'organizations')))
    await assertFails(getDoc(doc(anon(), 'organizations/orgA/members/alice')))
    await assertFails(getDocs(query(collectionGroup(anon(), 'members'), where('uid', '==', 'alice'))))
    await assertFails(getDoc(doc(anon(), '_meta/health')))
  })

  it.each(ALL_SUBS)('cannot read or write %s', async (sub) => {
    await assertFails(getDoc(doc(anon(), `organizations/orgA/${sub}/seed`)))
    await assertFails(getDocs(collection(anon(), `organizations/orgA/${sub}`)))
    await assertFails(setDoc(doc(anon(), `organizations/orgA/${sub}/new`), { orgId: 'orgA' }))
    await assertFails(updateDoc(doc(anon(), `organizations/orgA/${sub}/seed`), { name: 'x' }))
    await assertFails(deleteDoc(doc(anon(), `organizations/orgA/${sub}/seed`)))
  })
})

describe('clients never create or delete organizations or memberships', () => {
  it('cannot create an organization (any shape, any id)', async () => {
    await assertFails(addDoc(collection(as('erin'), 'organizations'), orgDoc('erin')))
    await assertFails(setDoc(doc(as('erin'), 'organizations/mine'), orgDoc('erin')))
    await assertFails(setDoc(doc(as('erin'), 'organizations/mine'), { ...orgDoc('erin'), members: { erin: { role: 'owner' } } }))
  })

  it('cannot take over an existing organization', async () => {
    await assertFails(setDoc(doc(as('erin'), 'organizations/orgA'), orgDoc('erin')))
    await assertFails(setDoc(doc(as('erin'), 'organizations/orgA'), { ownerId: 'erin' }, { merge: true }))
  })

  it('nobody can delete an organization, not even its owner', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'organizations/orgA')))
  })

  it('cannot create a membership: not for self in a foreign org, not for self in an own org', async () => {
    await assertFails(setDoc(doc(as('erin'), 'organizations/orgA/members/erin'), memberDoc('erin', 'owner')))
    await assertFails(setDoc(doc(as('alice'), 'organizations/orgA/members/alice2'), memberDoc('alice2', 'owner')))
    await assertFails(setDoc(doc(as('erin'), 'organizations/new/members/erin'), memberDoc('erin', 'owner')))
  })

  it('cannot change or delete a membership, not even the owner', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'organizations/orgA/members/dave'), { role: 'owner' }))
    await assertFails(updateDoc(doc(as('dave'), 'organizations/orgA/members/dave'), { role: 'owner' }))
    await assertFails(setDoc(doc(as('carol'), 'organizations/orgA/members/carol'), memberDoc('carol', 'owner')))
    await assertFails(deleteDoc(doc(as('alice'), 'organizations/orgA/members/alice')))
    await assertFails(deleteDoc(doc(as('dave'), 'organizations/orgA/members/dave')))
  })
})

describe('organization document', () => {
  it.each(ROLE_USERS)('$role can get the organization', async ({ uid }) => {
    await assertSucceeds(getDoc(doc(as(uid), 'organizations/orgA')))
  })

  it('a non-member, an unknown role and an anonymous user cannot get it', async () => {
    await assertFails(getDoc(doc(as('erin'), 'organizations/orgA')))
    await assertFails(getDoc(doc(as('frank'), 'organizations/orgA')))
    await assertFails(getDoc(doc(anon(), 'organizations/orgA')))
  })

  it('a member of another org only (bob) cannot get it', async () => {
    await assertFails(getDoc(doc(as('bob'), 'organizations/orgA')))
  })

  it.each([
    ['a list', ['owner']],
    ['a map', { role: 'owner' }],
    ['null', null],
    ['a missing field', undefined],
    ['the wrong case', 'Owner'],
  ])('a membership whose role is %s grants nothing', async (_label, role) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const data: Record<string, unknown> = { uid: 'mallory', createdAt: Timestamp.now(), addedBy: 'alice' }
      if (role !== undefined) data.role = role
      await setDoc(doc(fs(ctx), 'organizations/orgA/members/mallory'), data)
    })

    await assertFails(getDoc(doc(as('mallory'), 'organizations/orgA')))
    await assertFails(setDoc(doc(as('mallory'), 'organizations/orgA/accounts/x'), { orgId: 'orgA', name: 'x' }))
  })

  it('a missing organization cannot be read', async () => {
    await assertFails(getDoc(doc(as('alice'), 'organizations/ghost')))
  })

  it('nobody can list organizations (filtered by anything, or not)', async () => {
    await assertFails(getDocs(collection(as('alice'), 'organizations')))
    await assertFails(getDocs(query(collection(as('alice'), 'organizations'), where('ownerId', '==', 'alice'))))
    await assertFails(getDocs(query(collection(as('alice'), 'organizations'), where('members.alice.role', '!=', null))))
    await assertFails(getDocs(query(collection(as('alice'), 'organizations'), orderBy('name'))))
    await assertFails(getDocs(collectionGroup(as('alice'), 'organizations')))
  })

  it('the owner can change name and currency', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'organizations/orgA'), { name: 'Renamed' }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'organizations/orgA'), { currency: 'PLN' }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'organizations/orgA'), { name: 'New', currency: 'EUR' }))
  })

  it.each(['PLN', 'EUR', 'USD', 'UAH'])('the owner can set the currency %s', async (currency) => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'organizations/orgA'), { currency }))
  })

  it.each(['carol', 'dave', 'frank', 'erin', 'bob'])('%s cannot update it', async (uid) => {
    await assertFails(updateDoc(doc(as(uid), 'organizations/orgA'), { name: 'pwned' }))
  })

  it.each([
    ['plan', { plan: 'pro' }],
    ['trialEndsAt', { trialEndsAt: Timestamp.fromMillis(Date.now() + 365 * DAY) }],
    ['ownerId', { ownerId: 'bob' }],
    ['createdAt', { createdAt: 'x' }],
    ['a members map', { members: { alice: { role: 'owner' } } }],
    ['an unknown field', { stripeCustomerId: 'x' }],
    ['name plus plan', { name: 'ok', plan: 'pro' }],
    ['deleting currency', { currency: deleteField() }],
    ['deleting plan', { plan: deleteField() }],
    ['a 5000 character name', { name: 'x'.repeat(5000) }],
    ['an empty name', { name: '' }],
    ['a non-string name', { name: 123 }],
    ['a 4 letter currency', { currency: 'EURO' }],
    ['the currency $$$', { currency: '$$$' }],
    ['the unsupported currency GBP', { currency: 'GBP' }],
    ['a lowercase currency', { currency: 'pln' }],
    ['a name of only spaces', { name: '   ' }],
  ])('even the owner cannot update with %s', async (_label, data) => {
    await assertFails(updateDoc(doc(as('alice'), 'organizations/orgA'), data))
  })
})

describe('membership documents', () => {
  it.each(ROLE_USERS)('$role can read the own membership document', async ({ uid }) => {
    const snap = await assertSucceeds(getDoc(doc(as(uid), `organizations/orgA/members/${uid}`)))
    expect(snap.data()?.uid).toBe(uid)
  })

  it('a user can read the own document even when it does not exist (membership check)', async () => {
    const snap = await assertSucceeds(getDoc(doc(as('erin'), 'organizations/orgA/members/erin')))
    expect(snap.exists()).toBe(false)
  })

  it('the owner can read and list all memberships of the organization', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'organizations/orgA/members/dave')))
    const snap = await assertSucceeds(getDocs(collection(as('alice'), 'organizations/orgA/members')))
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['alice', 'carol', 'dave', 'frank'])
  })

  it('an accountant and a viewer cannot read other memberships or list them', async () => {
    for (const uid of ['carol', 'dave']) {
      await assertFails(getDoc(doc(as(uid), 'organizations/orgA/members/alice')))
      await assertFails(getDocs(collection(as(uid), 'organizations/orgA/members')))
    }
  })

  it('a stranger cannot read memberships of another organization', async () => {
    await assertFails(getDoc(doc(as('erin'), 'organizations/orgA/members/alice')))
    await assertFails(getDoc(doc(as('bob'), 'organizations/orgA/members/alice')))
    await assertFails(getDocs(collection(as('bob'), 'organizations/orgA/members')))
  })
})

describe('collection group query on members (the "my companies" query)', () => {
  const mine = (db: Firestore, uid: string) => query(collectionGroup(db, 'members'), where('uid', '==', uid))

  it('a user lists exactly their own memberships across organizations', async () => {
    const snap = await assertSucceeds(getDocs(mine(as('carol'), 'carol')))
    const orgIds = snap.docs.map((d) => d.ref.parent.parent?.id).sort()
    expect(orgIds).toEqual(['orgA', 'orgB'])
    expect(snap.docs.map((d) => d.data().role).sort()).toEqual(['accountant', 'viewer'])
  })

  it('a user without memberships gets an empty list, not an error', async () => {
    const snap = await assertSucceeds(getDocs(mine(as('erin'), 'erin')))
    expect(snap.size).toBe(0)
  })

  it('cannot query another uid or run the query unfiltered', async () => {
    await assertFails(getDocs(mine(as('alice'), 'bob')))
    await assertFails(getDocs(collectionGroup(as('alice'), 'members')))
    await assertFails(getDocs(query(collectionGroup(as('alice'), 'members'), where('role', '==', 'owner'))))
  })

  it('does not open other collection groups', async () => {
    for (const group of ['accounts', 'transactions', 'categories', 'bankConnections']) {
      await assertFails(getDocs(collectionGroup(as('alice'), group)))
    }
  })
})

describe('data subcollections by role', () => {
  describe.each(ROLE_USERS)('$role ($uid) in orgA', ({ uid, dataRead, dataWrite, bank }) => {
    it.each(DATA_SUBS)('%s: read per role', async (sub) => {
      await expectOutcome(dataRead, getDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
      await expectOutcome(dataRead, getDocs(collection(as(uid), `organizations/orgA/${sub}`)))
    })

    it.each(DATA_SUBS)('%s: create, update and delete per role', async (sub) => {
      await expectOutcome(dataWrite, setDoc(doc(as(uid), `organizations/orgA/${sub}/new1`), { orgId: 'orgA', name: 'n' }))
      await expectOutcome(dataWrite, addDoc(collection(as(uid), `organizations/orgA/${sub}`), { orgId: 'orgA', name: 'n' }))
      await expectOutcome(dataWrite, updateDoc(doc(as(uid), `organizations/orgA/${sub}/seed`), { name: 'changed' }))
      await expectOutcome(dataWrite, deleteDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
    })

    it('bankConnections: owner only (read and write)', async () => {
      await expectOutcome(bank, getDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed')))
      await expectOutcome(bank, getDocs(collection(as(uid), 'organizations/orgA/bankConnections')))
      await expectOutcome(bank, setDoc(doc(as(uid), 'organizations/orgA/bankConnections/new1'), { orgId: 'orgA' }))
      await expectOutcome(bank, updateDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed'), { name: 'x' }))
      await expectOutcome(bank, deleteDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed')))
    })
  })

  it.each([...ALL_SUBS])('%s: members of orgA have no access to orgB data (and vice versa)', async (sub) => {
    // alice (owner of A) and dave (viewer of A) have no membership in B; bob has none in A.
    for (const uid of ['alice', 'dave']) {
      await assertFails(getDoc(doc(as(uid), `organizations/orgB/${sub}/seed`)))
      await assertFails(getDocs(collection(as(uid), `organizations/orgB/${sub}`)))
      await assertFails(setDoc(doc(as(uid), `organizations/orgB/${sub}/new1`), { orgId: 'orgB' }))
      await assertFails(updateDoc(doc(as(uid), `organizations/orgB/${sub}/seed`), { name: 'x' }))
      await assertFails(deleteDoc(doc(as(uid), `organizations/orgB/${sub}/seed`)))
    }
    await assertFails(getDoc(doc(as('bob'), `organizations/orgA/${sub}/seed`)))
    await assertFails(setDoc(doc(as('bob'), `organizations/orgA/${sub}/new1`), { orgId: 'orgA' }))
  })

  it('the role is per organization: carol writes in orgA (accountant) but only reads in orgB (viewer)', async () => {
    await assertSucceeds(setDoc(doc(as('carol'), 'organizations/orgA/accounts/new1'), { orgId: 'orgA' }))
    await assertSucceeds(getDoc(doc(as('carol'), 'organizations/orgB/accounts/seed')))
    await assertFails(setDoc(doc(as('carol'), 'organizations/orgB/accounts/new1'), { orgId: 'orgB' }))
  })

  it('a membership with an unknown role grants nothing', async () => {
    await assertFails(getDoc(doc(as('frank'), 'organizations/orgA/accounts/seed')))
    await assertFails(setDoc(doc(as('frank'), 'organizations/orgA/accounts/new1'), { orgId: 'orgA' }))
  })

  it.each(DATA_SUBS)('%s: orgId must match the path org (owner and accountant)', async (sub) => {
    for (const uid of ['alice', 'carol']) {
      const db = as(uid)
      await assertFails(setDoc(doc(db, `organizations/orgA/${sub}/x1`), { orgId: 'orgB', name: 'x' }))
      await assertFails(addDoc(collection(db, `organizations/orgA/${sub}`), { orgId: 'orgB', name: 'x' }))
      await assertFails(updateDoc(doc(db, `organizations/orgA/${sub}/seed`), { orgId: 'orgB' }))
      await assertSucceeds(setDoc(doc(db, `organizations/orgA/${sub}/x2`), { orgId: 'orgA', name: 'x' }))
      await assertSucceeds(setDoc(doc(db, `organizations/orgA/${sub}/x3`), { name: 'no orgId' }))
    }
  })

  it('a viewer can run the journal query with combined filters', async () => {
    const q = query(
      collection(as('dave'), 'organizations/orgA/transactions'),
      orderBy('date', 'desc'),
      where('accountId', '==', 'acc1'),
      where('categoryId', '==', 'cat1'),
      where('date', '>=', Timestamp.fromDate(new Date('2026-01-01'))),
    )
    await assertSucceeds(getDocs(q))
  })

  it('cannot use a non-existent organization', async () => {
    await assertFails(setDoc(doc(as('alice'), 'organizations/ghost/transactions/t1'), { orgId: 'ghost' }))
    await assertFails(getDocs(collection(as('alice'), 'organizations/ghost/transactions')))
  })

  it('cannot use subcollections outside the allow-list or nested deeper', async () => {
    await assertFails(setDoc(doc(as('alice'), 'organizations/orgA/secrets/x'), { a: 1 }))
    await assertFails(getDoc(doc(as('alice'), 'organizations/orgA/secrets/x')))
    await assertFails(setDoc(doc(as('alice'), 'organizations/orgA/accounts/seed/history/h1'), { a: 1 }))
  })
})

describe('server-only and unknown paths', () => {
  it('a signed-in user cannot read or write _meta', async () => {
    await assertFails(getDoc(doc(as('alice'), '_meta/health')))
    await assertFails(setDoc(doc(as('alice'), '_meta/health'), { ok: false }))
  })

  it('a signed-in user cannot read or write fxTables', async () => {
    await assertFails(getDoc(doc(as('alice'), 'fxTables/2026-10')))
    await assertFails(setDoc(doc(as('alice'), 'fxTables/2026-10'), { month: '2026-10' }))
    await assertFails(getDoc(doc(anon(), 'fxTables/2026-10')))
  })

  it('everything else is denied by default', async () => {
    await assertFails(getDoc(doc(as('alice'), 'users/alice')))
    await assertFails(setDoc(doc(as('alice'), 'users/alice'), { a: 1 }))
    await assertFails(getDocs(collection(as('alice'), 'anything')))
  })
})
