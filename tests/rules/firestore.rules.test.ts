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
// Written by the server only (S05, S06, S10, S10t): clients may read accounts, transactions, rollups, counterparties, rules and tags, the owner reads audit.
const SERVER_WRITTEN_SUBS = ['accounts', 'transactions', 'rollups', 'audit', 'counterparties', 'rules', 'tags'] as const
const MEMBER_READ_SUBS = ['accounts', 'categories', 'transactions', 'rollups', 'counterparties', 'rules', 'tags'] as const
const ALL_SUBS = ['accounts', 'categories', 'transactions', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'counterparties', 'rules', 'tags'] as const
// S09: the bank collections written by the server only. bankAccounts and bankSeen are closed to every client role.
const BANK_SERVER_ONLY_SUBS = ['bankAccounts', 'bankSeen'] as const

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
  { role: 'owner', uid: 'alice', categoryWrite: true, bank: true, audit: true },
  { role: 'accountant', uid: 'carol', categoryWrite: true, bank: false, audit: false },
  { role: 'viewer', uid: 'dave', categoryWrite: false, bank: false, audit: false },
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
    await setDoc(doc(db, 'organizations/orgA/ledger/lock'), { holder: 'server' })
    await setDoc(doc(db, 'organizations/orgB/ledger/lock'), { holder: 'server' })
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
    await assertFails(getDoc(doc(as('mallory'), 'organizations/orgA/accounts/seed')))
    await assertFails(setDoc(doc(as('mallory'), 'organizations/orgA/categories/x'), { orgId: 'orgA', name: 'x' }))
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

  // The name and currency change through PATCH /api/orgs/{orgId} (S05); no client writes the organization.
  it.each(['alice', 'carol', 'dave', 'frank', 'erin', 'bob'])('%s cannot update or delete the organization from a client', async (uid) => {
    const ref = doc(as(uid), 'organizations/orgA')
    await assertFails(updateDoc(ref, { name: 'Renamed' }))
    await assertFails(updateDoc(ref, { currency: 'PLN' }))
    await assertFails(updateDoc(ref, { name: 'New', currency: 'EUR' }))
    await assertFails(updateDoc(ref, { plan: 'pro' }))
    await assertFails(updateDoc(ref, { currency: deleteField() }))
    await assertFails(deleteDoc(ref))
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
    for (const group of ['accounts', 'transactions', 'categories', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'ledger', 'counterparties', 'counterpartyKeys', 'rules', 'tags', 'tagKeys']) {
      await assertFails(getDocs(collectionGroup(as('alice'), group)))
    }
  })
})

describe('data subcollections by role', () => {
  describe.each(ROLE_USERS)('$role ($uid) in orgA', ({ uid, categoryWrite, bank, audit }) => {
    it.each(MEMBER_READ_SUBS)('%s: every member can read', async (sub) => {
      await assertSucceeds(getDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
      await assertSucceeds(getDocs(collection(as(uid), `organizations/orgA/${sub}`)))
    })

    it.each(SERVER_WRITTEN_SUBS)('%s: nobody creates, updates or deletes from a client', async (sub) => {
      await assertFails(setDoc(doc(as(uid), `organizations/orgA/${sub}/new1`), { orgId: 'orgA', name: 'n' }))
      await assertFails(addDoc(collection(as(uid), `organizations/orgA/${sub}`), { orgId: 'orgA', name: 'n' }))
      await assertFails(updateDoc(doc(as(uid), `organizations/orgA/${sub}/seed`), { name: 'changed' }))
      await assertFails(deleteDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
    })

    it('audit: only the owner reads', async () => {
      await expectOutcome(audit, getDoc(doc(as(uid), 'organizations/orgA/audit/seed')))
      await expectOutcome(audit, getDocs(collection(as(uid), 'organizations/orgA/audit')))
    })

    it('ledger/lock: no read or write for any role', async () => {
      await assertFails(getDoc(doc(as(uid), 'organizations/orgA/ledger/lock')))
      await assertFails(getDocs(collection(as(uid), 'organizations/orgA/ledger')))
      await assertFails(setDoc(doc(as(uid), 'organizations/orgA/ledger/lock'), { holder: uid }))
      await assertFails(updateDoc(doc(as(uid), 'organizations/orgA/ledger/lock'), { holder: uid }))
      await assertFails(deleteDoc(doc(as(uid), 'organizations/orgA/ledger/lock')))
    })

    it('categories: owner and accountant write, a viewer only reads', async () => {
      await expectOutcome(categoryWrite, setDoc(doc(as(uid), 'organizations/orgA/categories/new1'), { orgId: 'orgA', name: 'n' }))
      await expectOutcome(categoryWrite, addDoc(collection(as(uid), 'organizations/orgA/categories'), { orgId: 'orgA', name: 'n' }))
      await expectOutcome(categoryWrite, updateDoc(doc(as(uid), 'organizations/orgA/categories/seed'), { name: 'changed' }))
      await expectOutcome(categoryWrite, deleteDoc(doc(as(uid), 'organizations/orgA/categories/seed')))
    })

    it('bankConnections: the owner reads, nobody writes from a client (the server saves the session)', async () => {
      await expectOutcome(bank, getDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed')))
      await expectOutcome(bank, getDocs(collection(as(uid), 'organizations/orgA/bankConnections')))
      await assertFails(setDoc(doc(as(uid), 'organizations/orgA/bankConnections/new1'), { orgId: 'orgA' }))
      await assertFails(updateDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed'), { name: 'x' }))
      await assertFails(deleteDoc(doc(as(uid), 'organizations/orgA/bankConnections/seed')))
    })

    it.each(BANK_SERVER_ONLY_SUBS)('%s: closed to every role, for reads and writes', async (sub) => {
      await assertFails(getDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
      await assertFails(getDocs(collection(as(uid), `organizations/orgA/${sub}`)))
      await assertFails(setDoc(doc(as(uid), `organizations/orgA/${sub}/new1`), { orgId: 'orgA' }))
      await assertFails(updateDoc(doc(as(uid), `organizations/orgA/${sub}/seed`), { name: 'x' }))
      await assertFails(deleteDoc(doc(as(uid), `organizations/orgA/${sub}/seed`)))
    })
  })

  it.each([...ALL_SUBS, 'ledger'])('%s: members of orgA have no access to orgB data (and vice versa)', async (sub) => {
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

  it('the role is per organization: carol writes categories in orgA (accountant) but only reads in orgB (viewer)', async () => {
    await assertSucceeds(setDoc(doc(as('carol'), 'organizations/orgA/categories/new1'), { orgId: 'orgA' }))
    await assertSucceeds(getDoc(doc(as('carol'), 'organizations/orgB/accounts/seed')))
    await assertFails(setDoc(doc(as('carol'), 'organizations/orgB/categories/new1'), { orgId: 'orgB' }))
  })

  it('a membership with an unknown role grants nothing', async () => {
    await assertFails(getDoc(doc(as('frank'), 'organizations/orgA/accounts/seed')))
    await assertFails(setDoc(doc(as('frank'), 'organizations/orgA/categories/new1'), { orgId: 'orgA' }))
  })

  it('categories: orgId must match the path org (owner and accountant)', async () => {
    for (const uid of ['alice', 'carol']) {
      const db = as(uid)
      await assertFails(setDoc(doc(db, 'organizations/orgA/categories/x1'), { orgId: 'orgB', name: 'x' }))
      await assertFails(addDoc(collection(db, 'organizations/orgA/categories'), { orgId: 'orgB', name: 'x' }))
      await assertFails(updateDoc(doc(db, 'organizations/orgA/categories/seed'), { orgId: 'orgB' }))
      await assertSucceeds(setDoc(doc(db, 'organizations/orgA/categories/x2'), { orgId: 'orgA', name: 'x' }))
      await assertSucceeds(setDoc(doc(db, 'organizations/orgA/categories/x3'), { name: 'no orgId' }))
    }
  })

  it('a viewer can run the journal query with combined filters', async () => {
    const q = query(
      collection(as('dave'), 'organizations/orgA/transactions'),
      orderBy('paymentDate', 'desc'),
      where('accountId', '==', 'acc1'),
      where('categoryId', '==', 'cat1'),
      where('paymentDate', '>=', '2026-01-01'),
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

describe('counterparty keys and rate limits are closed to every client', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), 'organizations/orgA/counterpartyKeys/name_acme'), { counterpartyId: 'c1' })
      await setDoc(doc(fs(ctx), 'rateLimits/lookup_alice_m_1'), { count: 1 })
    })
  })

  it.each(['alice', 'carol', 'dave', 'erin'])('%s cannot read or write a counterparty key', async (uid) => {
    const key = doc(as(uid), 'organizations/orgA/counterpartyKeys/name_acme')
    await assertFails(getDoc(key))
    await assertFails(getDocs(collection(as(uid), 'organizations/orgA/counterpartyKeys')))
    await assertFails(setDoc(doc(as(uid), 'organizations/orgA/counterpartyKeys/name_new'), { counterpartyId: 'c2' }))
    await assertFails(updateDoc(key, { counterpartyId: 'c2' }))
    await assertFails(deleteDoc(key))
  })

  it.each(['alice', 'carol', 'dave', 'erin'])('%s cannot read or write a rate-limit counter', async (uid) => {
    const counter = doc(as(uid), 'rateLimits/lookup_alice_m_1')
    await assertFails(getDoc(counter))
    await assertFails(setDoc(doc(as(uid), 'rateLimits/lookup_alice_m_2'), { count: 0 }))
    await assertFails(updateDoc(counter, { count: 0 }))
    await assertFails(deleteDoc(counter))
  })

  it('an anonymous caller cannot read them either', async () => {
    await assertFails(getDoc(doc(anon(), 'organizations/orgA/counterpartyKeys/name_acme')))
    await assertFails(getDoc(doc(anon(), 'rateLimits/lookup_alice_m_1')))
  })
})

describe('tag keys are closed to every client (S10t)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), 'organizations/orgA/tagKeys/name_vat'), { tagId: 't1' })
    })
  })

  it.each(['alice', 'carol', 'dave', 'erin'])('%s cannot read or write a tag key', async (uid) => {
    const key = doc(as(uid), 'organizations/orgA/tagKeys/name_vat')
    await assertFails(getDoc(key))
    await assertFails(getDocs(collection(as(uid), 'organizations/orgA/tagKeys')))
    await assertFails(setDoc(doc(as(uid), 'organizations/orgA/tagKeys/name_new'), { tagId: 't2' }))
    await assertFails(updateDoc(key, { tagId: 't2' }))
    await assertFails(deleteDoc(key))
  })

  it('an anonymous caller cannot read them either', async () => {
    await assertFails(getDoc(doc(anon(), 'organizations/orgA/tagKeys/name_vat')))
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
