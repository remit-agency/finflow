import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { BankError } from '@/lib/server/banking/errors'
import { banking } from '@/lib/server/banking'
import { GET as getStatus } from '@/app/api/orgs/[orgId]/bank/route'
import { DELETE as deleteConnection, GET as getConnection } from '@/app/api/orgs/[orgId]/bank/connections/[connectionId]/route'
import { POST as postAccount } from '@/app/api/orgs/[orgId]/bank/accounts/route'
import { POST as postSync } from '@/app/api/orgs/[orgId]/bank/sync/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
// The banking module talks to Enable Banking and Firestore; the routes are tested with it replaced.
vi.mock('@/lib/server/banking', () => ({
  bankDeps: vi.fn(() => ({ marker: 'deps' })),
  banking: {
    readStatus: vi.fn(),
    listConnectionAccounts: vi.fn(),
    disconnect: vi.fn(),
    linkAccount: vi.fn(),
    syncStep: vi.fn(),
  },
}))

const ORG = 'org-acme'
const CONN = 'sess-1'
const LINK_BODY = { connectionId: CONN, ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' }
const SYNC_OK = { imported: 3, skipped: 0, failed: 0, done: true, bankBalanceMinor: 100, differenceMinor: 0 }

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice', contentType = 'application/json'): Request {
  const headers: Record<string, string> = { Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  if (body !== undefined) headers['Content-Type'] = contentType
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const ctx = <T extends Record<string, string> = Record<never, never>>(extra?: T) => ({
  params: Promise.resolve({ orgId: ORG, ...extra } as { orgId: string } & T),
})

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of [banking.readStatus, banking.listConnectionAccounts, banking.disconnect, banking.linkAccount, banking.syncStep]) {
    vi.mocked(fn).mockReset()
  }
})

describe('GET /api/orgs/{orgId}/bank', () => {
  it('answers 401 without a session', async () => {
    expect((await getStatus(req('GET', `/api/orgs/${ORG}/bank`, undefined, null), ctx())).status).toBe(401)
    expect(banking.readStatus).not.toHaveBeenCalled()
  })

  it('answers 403 to a user who is not a member', async () => {
    expect((await getStatus(req('GET', `/api/orgs/${ORG}/bank`, undefined, 'token-mallory'), ctx())).status).toBe(403)
  })

  it.each([
    ['owner', 'token-alice'],
    ['accountant', 'token-carol'],
    ['viewer', 'token-dave'],
  ])('passes the %s role on and answers 200 with no-store', async (role, token) => {
    vi.mocked(banking.readStatus).mockResolvedValue({ connections: [] })
    const res = await getStatus(req('GET', `/api/orgs/${ORG}/bank`, undefined, token), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ connections: [] })
    expect(banking.readStatus).toHaveBeenCalledWith({ marker: 'deps' }, ORG, role)
  })
})

describe('/api/orgs/{orgId}/bank/connections/{connectionId}', () => {
  it('GET answers 401 without a session and 403 to an accountant', async () => {
    expect((await getConnection(req('GET', `/api/orgs/${ORG}/bank/connections/${CONN}`, undefined, null), ctx({ connectionId: CONN }))).status).toBe(401)
    expect((await getConnection(req('GET', `/api/orgs/${ORG}/bank/connections/${CONN}`, undefined, 'token-carol'), ctx({ connectionId: CONN }))).status).toBe(403)
    expect(banking.listConnectionAccounts).not.toHaveBeenCalled()
  })

  it('GET lets the owner list the bank accounts', async () => {
    vi.mocked(banking.listConnectionAccounts).mockResolvedValue({ accounts: [] })
    const res = await getConnection(req('GET', `/api/orgs/${ORG}/bank/connections/${CONN}`), ctx({ connectionId: CONN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accounts: [] })
    expect(banking.listConnectionAccounts).toHaveBeenCalledWith({ marker: 'deps' }, ORG, CONN)
  })

  it('GET answers 400 for a connection id that is not a plain id', async () => {
    const res = await getConnection(req('GET', `/api/orgs/${ORG}/bank/connections/x`), ctx({ connectionId: 'a.b' }))
    expect(res.status).toBe(400)
    expect(banking.listConnectionAccounts).not.toHaveBeenCalled()
  })

  it('DELETE answers 403 to an accountant and 204 to the owner', async () => {
    expect((await deleteConnection(req('DELETE', `/api/orgs/${ORG}/bank/connections/${CONN}`, undefined, 'token-carol'), ctx({ connectionId: CONN }))).status).toBe(403)
    expect(banking.disconnect).not.toHaveBeenCalled()
    vi.mocked(banking.disconnect).mockResolvedValue(undefined)
    const res = await deleteConnection(req('DELETE', `/api/orgs/${ORG}/bank/connections/${CONN}`), ctx({ connectionId: CONN }))
    expect(res.status).toBe(204)
    expect(banking.disconnect).toHaveBeenCalledWith({ marker: 'deps' }, ORG, CONN)
  })
})

describe('POST /api/orgs/{orgId}/bank/accounts', () => {
  it('answers 403 to an accountant and never links', async () => {
    const res = await postAccount(req('POST', `/api/orgs/${ORG}/bank/accounts`, LINK_BODY, 'token-carol'), ctx())
    expect(res.status).toBe(403)
    expect(banking.linkAccount).not.toHaveBeenCalled()
  })

  it('links for the owner with 201 and passes the parsed input and the uid', async () => {
    vi.mocked(banking.linkAccount).mockResolvedValue({ bankAccountId: 'ba1', accountId: 'a1' })
    const res = await postAccount(req('POST', `/api/orgs/${ORG}/bank/accounts`, LINK_BODY), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ bankAccountId: 'ba1', accountId: 'a1' })
    expect(banking.linkAccount).toHaveBeenCalledWith({ marker: 'deps' }, ORG, 'user-alice', expect.objectContaining({ connectionId: CONN, ebAccountUid: 'eb-u1', mode: 'create', importFrom: '2026-07-30' }))
  })

  it('answers 400 for a body that does not parse, without calling the banking module', async () => {
    const res = await postAccount(req('POST', `/api/orgs/${ORG}/bank/accounts`, { ...LINK_BODY, mode: 'maybe' }), ctx())
    expect(res.status).toBe(400)
    expect(banking.linkAccount).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON', async () => {
    const res = await postAccount(req('POST', `/api/orgs/${ORG}/bank/accounts`, '{not json'), ctx())
    expect(res.status).toBe(400)
    expect(banking.linkAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/orgs/{orgId}/bank/sync', () => {
  it('answers 403 to an accountant and never syncs', async () => {
    const res = await postSync(req('POST', `/api/orgs/${ORG}/bank/sync`, { bankAccountId: 'ba1' }, 'token-carol'), ctx())
    expect(res.status).toBe(403)
    expect(banking.syncStep).not.toHaveBeenCalled()
  })

  it('runs one step for the owner and answers 200 with the step result', async () => {
    vi.mocked(banking.syncStep).mockResolvedValue(SYNC_OK)
    const res = await postSync(req('POST', `/api/orgs/${ORG}/bank/sync`, { bankAccountId: 'ba1' }), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(SYNC_OK)
    expect(banking.syncStep).toHaveBeenCalledWith({ marker: 'deps' }, ORG, 'user-alice', 'ba1')
  })

  it.each([
    ['a missing id', {}],
    ['an id with a slash', { bankAccountId: 'a/b' }],
    ['a number', { bankAccountId: 7 }],
    ['an array body', []],
    ['a null body', null],
  ])('answers 400 invalid_input for %s', async (_label, body) => {
    const res = await postSync(req('POST', `/api/orgs/${ORG}/bank/sync`, body), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(banking.syncStep).not.toHaveBeenCalled()
  })

  it.each([
    ['consent_expired', 409],
    ['already_running', 409],
    ['rate_limited', 429],
    ['bank_unavailable', 503],
  ] as const)('maps BankError %s to HTTP %i with the code as the error', async (code, status) => {
    vi.mocked(banking.syncStep).mockRejectedValue(new BankError(code))
    const res = await postSync(req('POST', `/api/orgs/${ORG}/bank/sync`, { bankAccountId: 'ba1' }), ctx())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })
})
