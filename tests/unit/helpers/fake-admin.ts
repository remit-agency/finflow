import { vi } from 'vitest'

/**
 * In-memory stand-in for getAdmin() from '@/lib/server/firebase-admin'.
 * Route tests mock that module with `{ getAdmin: () => fakeAdmin }`, so the REAL
 * requireUser / requireVerifiedUser / requireOrgRole from '@/lib/server/auth' run against this data.
 * `organizations/{orgId}` and `organizations/{orgId}/members/{uid}` documents are modelled; both
 * db.doc(path) and db.collection(name).doc(id) access styles are supported.
 */
export const fakeOrgs = new Map<string, Record<string, unknown>>()

/** organizations/{orgId}/members/{uid}, keyed `${orgId}/${uid}`. */
export const fakeMembers = new Map<string, Record<string, unknown>>()

/** Any other document, keyed by its full path (for example organizations/{orgId}/counterparties/{id}). */
export const fakeOtherDocs = new Map<string, Record<string, unknown>>()

/** Set `failOnCreatePathIncludes` to make db.runTransaction's tx.create throw for matching paths (atomicity tests). */
export const fakeTxFault: { failOnCreatePathIncludes: string | null } = { failOnCreatePathIncludes: null }

let autoIdCounter = 0
const autoId = () => String(++autoIdCounter).padStart(20, '0')

function readPath(path: string): Record<string, unknown> | undefined {
  const s = path.split('/')
  if (s[0] !== 'organizations') return undefined
  if (s.length === 2) return fakeOrgs.get(s[1])
  if (s.length === 4 && s[2] === 'members') return fakeMembers.get(`${s[1]}/${s[3]}`)
  return fakeOtherDocs.get(path)
}

function writePath(path: string, data: Record<string, unknown>): void {
  const s = path.split('/')
  if (s.length === 2) fakeOrgs.set(s[1], data)
  else if (s.length === 4 && s[2] === 'members') fakeMembers.set(`${s[1]}/${s[3]}`, data)
  else fakeOtherDocs.set(path, data)
}

/** Accepted credential -> uid. Used for BOTH session-cookie values and ID tokens. */
export const fakeTokens = new Map<string, string>()

/** uids whose email is NOT verified (everyone else is verified). */
export const fakeUnverified = new Set<string>()

/** ID token -> seconds since its sign-in (default 0 = just signed in). */
export const fakeIdTokenAgeSec = new Map<string, number>()

export const TEST_EB_STATE_SECRET = 'route-test-secret-0123456789abcdef'
export const TEST_APP_URL = 'https://finflow.test'

function snapshotFor(path: string) {
  const data = readPath(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data === undefined ? undefined : data[field]),
  }
}

type FakeDocRef = {
  id: string
  path: string
  get: () => Promise<ReturnType<typeof snapshotFor>>
  collection: (name: string) => { doc: (id?: string) => FakeDocRef }
}

function docRef(path: string): FakeDocRef {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotFor(path),
    collection: (name: string) => ({ doc: (id?: string) => docRef(`${path}/${name}/${id ?? autoId()}`) }),
  }
}

function invalid(what: string): Error {
  // Like the real Admin SDK: a rejected credential carries an `auth/...` code, which
  // toAuthHttpError maps to 401 (errors without such a code become 503).
  return Object.assign(new Error(`invalid ${what}`), { code: 'auth/argument-error' })
}

type FakeTx = {
  get: (q: { group: string; field: string; value: unknown }) => Promise<{
    docs: Array<{ id: string; get: (field: string) => unknown; data: () => Record<string, unknown> }>
  }>
  create: (ref: { path: string }, data: Record<string, unknown>) => void
}

export const fakeAdmin = {
  db: {
    doc: (path: string) => docRef(path),
    collection: (name: string) => ({ doc: (id?: string) => docRef(`${name}/${id ?? autoId()}`) }),
    // Only the one query shape the app uses: collectionGroup('members').where('uid', '==', value).
    collectionGroup: (name: string) => ({
      where: (field: string, _op: '==', value: unknown) => ({ group: name, field, value }),
    }),
    // Atomic: creates are staged and applied only if the callback resolves.
    runTransaction: async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => {
      const staged: Array<[string, Record<string, unknown>]> = []
      const tx: FakeTx = {
        get: async (q) => ({
          docs: [...fakeMembers.entries()]
            .filter(([, data]) => q.group === 'members' && data[q.field] === q.value)
            .map(([key, data]) => ({ id: key.split('/')[1], get: (f: string) => data[f], data: () => data })),
        }),
        create: (ref, data) => {
          const { failOnCreatePathIncludes: fail } = fakeTxFault
          if (fail !== null && ref.path.includes(fail)) throw new Error('fake transaction failure')
          if (readPath(ref.path) !== undefined || staged.some(([p]) => p === ref.path)) {
            throw Object.assign(new Error('already exists'), { code: 6 })
          }
          staged.push([ref.path, data])
        },
      }
      const result = await fn(tx)
      for (const [path, data] of staged) writePath(path, data)
      return result
    },
  },
  auth: {
    verifyIdToken: vi.fn(async (token: string) => {
      const uid = fakeTokens.get(token)
      if (!uid) throw invalid('id token')
      return {
        uid,
        auth_time: Math.floor(Date.now() / 1000) - (fakeIdTokenAgeSec.get(token) ?? 0),
      }
    }),
    verifySessionCookie: vi.fn(async (cookie: string) => {
      const uid = fakeTokens.get(cookie)
      if (!uid) throw invalid('session cookie')
      return { uid, email_verified: !fakeUnverified.has(uid) }
    }),
    getUser: vi.fn(async (uid: string) => {
      if (![...fakeTokens.values()].includes(uid)) {
        throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
      }
      return { uid, emailVerified: !fakeUnverified.has(uid) }
    }),
    createSessionCookie: vi.fn<(idToken: string, options: { expiresIn: number }) => Promise<string>>(
      async () => 'minted-session-cookie',
    ),
    revokeRefreshTokens: vi.fn<(uid: string) => Promise<void>>(async () => {}),
  },
}

/**
 * Resets the fixture:
 *  - alice owns org-acme and has a verified email;
 *  - carol is an accountant and dave a viewer of org-acme;
 *  - mallory is signed in with a verified email but is not a member of anything;
 *  - bob is signed in but his email is NOT verified.
 * Each user has a credential named token-<name> (works as an ID token and as a session cookie).
 */
export function resetFakeAdmin(): void {
  fakeOrgs.clear()
  fakeMembers.clear()
  fakeOtherDocs.clear()
  fakeTxFault.failOnCreatePathIncludes = null
  fakeTokens.clear()
  fakeUnverified.clear()
  fakeIdTokenAgeSec.clear()
  fakeTokens.set('token-alice', 'user-alice')
  fakeTokens.set('token-carol', 'user-carol')
  fakeTokens.set('token-dave', 'user-dave')
  fakeTokens.set('token-mallory', 'user-mallory')
  fakeTokens.set('token-bob', 'user-bob')
  fakeUnverified.add('user-bob')
  fakeOrgs.set('org-acme', {
    name: 'Acme',
    currency: 'PLN',
    ownerId: 'user-alice',
    plan: 'trial',
  })
  fakeMembers.set('org-acme/user-alice', { uid: 'user-alice', role: 'owner' })
  fakeMembers.set('org-acme/user-carol', { uid: 'user-carol', role: 'accountant' })
  fakeMembers.set('org-acme/user-dave', { uid: 'user-dave', role: 'viewer' })
  for (const fn of Object.values(fakeAdmin.auth)) fn.mockReset()
}

/** A JSON Response, as returned by the mocked global fetch for Enable Banking calls. */
export function upstreamJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
