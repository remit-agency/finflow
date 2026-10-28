import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { FxError } from '@/lib/server/fx/types'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { ledger } from '@/lib/server/ledger'
import { PATCH as patchOrg } from '@/app/api/orgs/[orgId]/route'
import { POST as postTx } from '@/app/api/orgs/[orgId]/transactions/route'
import { DELETE as deleteTx, PATCH as patchTx } from '@/app/api/orgs/[orgId]/transactions/[txId]/route'
import { POST as postAccount } from '@/app/api/orgs/[orgId]/accounts/route'
import { DELETE as deleteAccount, PATCH as patchAccount } from '@/app/api/orgs/[orgId]/accounts/[accountId]/route'
import { POST as rebuild } from '@/app/api/orgs/[orgId]/ledger/rebuild/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/ledger', () => ({
  ledger: {
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    updateOrganization: vi.fn(),
    rebuild: vi.fn(),
  },
}))

const TX = { id: 't1', type: 'income' }
const BODY_TX = { type: 'income', accountId: 'acc1', amountMinor: 1000, paymentDate: '2026-10-20' }
const BODY_ACCOUNT = { name: 'Main', type: 'bank', currency: 'PLN', color: '#112233', openingMinor: 0 }

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const ctx = <T extends Record<string, string> = Record<never, never>>(extra?: T) => ({
  params: Promise.resolve({ orgId: 'org-acme', ...extra } as { orgId: string } & T),
})

type Call = { name: string; mock: keyof typeof ledger; call: (token: string | null) => Promise<Response> }

const ROUTES: Call[] = [
  { name: 'postTx', mock: 'createTransaction', call: (t) => postTx(req('POST', '/api/orgs/org-acme/transactions', BODY_TX, t), ctx()) },
  { name: 'patchTx', mock: 'updateTransaction', call: (t) => patchTx(req('PATCH', '/api/orgs/org-acme/transactions/t1', { description: 'x' }, t), ctx({ txId: 't1' })) },
  { name: 'deleteTx', mock: 'deleteTransaction', call: (t) => deleteTx(req('DELETE', '/api/orgs/org-acme/transactions/t1', undefined, t), ctx({ txId: 't1' })) },
  { name: 'postAccount', mock: 'createAccount', call: (t) => postAccount(req('POST', '/api/orgs/org-acme/accounts', BODY_ACCOUNT, t), ctx()) },
  { name: 'patchAccount', mock: 'updateAccount', call: (t) => patchAccount(req('PATCH', '/api/orgs/org-acme/accounts/a1', { name: 'New' }, t), ctx({ accountId: 'a1' })) },
  { name: 'deleteAccount', mock: 'deleteAccount', call: (t) => deleteAccount(req('DELETE', '/api/orgs/org-acme/accounts/a1', undefined, t), ctx({ accountId: 'a1' })) },
  { name: 'patchOrg', mock: 'updateOrganization', call: (t) => patchOrg(req('PATCH', '/api/orgs/org-acme', { name: 'New' }, t), ctx()) },
  { name: 'rebuild', mock: 'rebuild', call: (t) => rebuild(req('POST', '/api/orgs/org-acme/ledger/rebuild', undefined, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(ledger)) vi.mocked(fn).mockReset()
})

describe('authorization of every ledger route', () => {
  describe.each(ROUTES)('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(ledger[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(ledger[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a viewer', async () => {
      expect((await call('token-dave')).status).toBe(403)
      expect(ledger[mock]).not.toHaveBeenCalled()
    })
  })

  describe.each(ROUTES.filter((r) => r.name === 'patchOrg' || r.name === 'rebuild'))('owner only: $name', ({ mock, call }) => {
    it('answers 403 to an accountant', async () => {
      expect((await call('token-carol')).status).toBe(403)
      expect(ledger[mock]).not.toHaveBeenCalled()
    })

    it('lets the owner through', async () => {
      vi.mocked(ledger.updateOrganization).mockResolvedValue({ name: 'New', currency: 'PLN' })
      vi.mocked(ledger.rebuild).mockResolvedValue({ applied: false } as never)
      expect((await call('token-alice')).status).toBe(200)
      expect(ledger[mock]).toHaveBeenCalledTimes(1)
    })
  })
})

describe('POST /transactions', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('creates for %s with 201 and passes the parsed input', async (name, uid) => {
    vi.mocked(ledger.createTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', BODY_TX, `token-${name}`), ctx())
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ transaction: TX })
    expect(ledger.createTransaction).toHaveBeenCalledWith('org-acme', uid, expect.objectContaining({ type: 'income', accountId: 'acc1', amountMinor: 1000, paymentDate: '2026-10-20' }))
  })

  it('answers 200 for a replayed create', async () => {
    vi.mocked(ledger.createTransaction).mockResolvedValue({ transaction: TX, replayed: true } as never)
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', BODY_TX), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transaction: TX })
  })

  it('passes a bank-prefixed client id on to the ledger, which accepts it only with the bank mark (undo of a bank operation)', async () => {
    vi.mocked(ledger.createTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', { ...BODY_TX, clientId: 'bk_0123456789abcdef0123456789abcdef' }, 'token-alice'), ctx())
    expect(res.status).toBe(201)
    expect(ledger.createTransaction).toHaveBeenCalledWith('org-acme', 'user-alice', expect.objectContaining({ clientId: 'bk_0123456789abcdef0123456789abcdef' }))
  })

  it('answers 400 invalid_input for a bank-prefixed client id the ledger refuses (no bank mark)', async () => {
    vi.mocked(ledger.createTransaction).mockRejectedValue(new LedgerError('invalid_input', 'clientId'))
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', { ...BODY_TX, clientId: 'bk_0123456789abcdef0123456789abcdef' }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
  })

  it('answers 400 invalid_input for an unknown key and does not call the ledger', async () => {
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', { ...BODY_TX, surprise: 1 }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(ledger.createTransaction).not.toHaveBeenCalled()
  })

  it('accepts the largest valid body (10 file URLs of 2048 characters, about 20 KB) and still answers 413 above the limit', async () => {
    vi.mocked(ledger.createTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    vi.mocked(ledger.updateTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    const url = (i: number) => `https://files.example.com/${i}/`.padEnd(2048, 'a')
    const fileUrls = Array.from({ length: 10 }, (_, i) => url(i))
    const body = JSON.stringify({ ...BODY_TX, fileUrls })
    expect(body.length).toBeGreaterThan(20_000)

    const ok = await postTx(req('POST', '/api/orgs/org-acme/transactions', body), ctx())
    expect(ok.status).toBe(201)
    const patch = await patchTx(req('PATCH', '/api/orgs/org-acme/transactions/t1', JSON.stringify({ fileUrls })), ctx({ txId: 't1' }))
    expect(patch.status).toBe(200)

    const huge = JSON.stringify({ ...BODY_TX, description: 'x'.repeat(40_000) })
    expect((await postTx(req('POST', '/api/orgs/org-acme/transactions', huge), ctx())).status).toBe(413)
    expect((await patchTx(req('PATCH', '/api/orgs/org-acme/transactions/t1', huge), ctx({ txId: 't1' }))).status).toBe(413)
  })

  it('answers 400 invalid_body for a body that is not JSON', async () => {
    const res = await postTx(req('POST', '/api/orgs/org-acme/transactions', '{nope'), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(ledger.createTransaction).not.toHaveBeenCalled()
  })
})

describe('PATCH /transactions/{txId}', () => {
  it('passes the patch to the ledger and returns the transaction', async () => {
    vi.mocked(ledger.updateTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    const res = await patchTx(req('PATCH', '/api/orgs/org-acme/transactions/t1', { description: 'new' }), ctx({ txId: 't1' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ transaction: TX })
    expect(ledger.updateTransaction).toHaveBeenCalledWith('org-acme', 'user-alice', 't1', { description: 'new' })
  })

  it('answers 404 for an id with a dot', async () => {
    const res = await patchTx(req('PATCH', '/api/orgs/org-acme/transactions/a.b', { description: 'x' }), ctx({ txId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(ledger.updateTransaction).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty patch', async () => {
    const res = await patchTx(req('PATCH', '/api/orgs/org-acme/transactions/t1', {}), ctx({ txId: 't1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
    expect(ledger.updateTransaction).not.toHaveBeenCalled()
  })
})

describe('DELETE routes', () => {
  it('deleteTx answers 204 with an empty body', async () => {
    vi.mocked(ledger.deleteTransaction).mockResolvedValue({ transaction: TX, replayed: false } as never)
    const res = await deleteTx(req('DELETE', '/api/orgs/org-acme/transactions/t1'), ctx({ txId: 't1' }))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(ledger.deleteTransaction).toHaveBeenCalledWith('org-acme', 'user-alice', 't1')
  })

  it('deleteTx answers 404 for an id with a dot', async () => {
    const res = await deleteTx(req('DELETE', '/api/orgs/org-acme/transactions/a.b'), ctx({ txId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(ledger.deleteTransaction).not.toHaveBeenCalled()
  })

  it('deleteAccount answers 204 with an empty body', async () => {
    vi.mocked(ledger.deleteAccount).mockResolvedValue(undefined)
    const res = await deleteAccount(req('DELETE', '/api/orgs/org-acme/accounts/a1'), ctx({ accountId: 'a1' }))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(ledger.deleteAccount).toHaveBeenCalledWith('org-acme', 'user-alice', 'a1')
  })

  it('deleteAccount answers 404 for an id with a dot', async () => {
    const res = await deleteAccount(req('DELETE', '/api/orgs/org-acme/accounts/a.b'), ctx({ accountId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(ledger.deleteAccount).not.toHaveBeenCalled()
  })
})

describe('accounts and company settings', () => {
  const ACCOUNT = { id: 'a1', ...BODY_ACCOUNT, balanceMinor: 0 }

  it('postAccount answers 201 with the account', async () => {
    vi.mocked(ledger.createAccount).mockResolvedValue(ACCOUNT as never)
    const res = await postAccount(req('POST', '/api/orgs/org-acme/accounts', BODY_ACCOUNT), ctx())
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ account: ACCOUNT })
    expect(ledger.createAccount).toHaveBeenCalledWith('org-acme', 'user-alice', BODY_ACCOUNT)
  })

  it('postAccount answers 400 for an incomplete body', async () => {
    const res = await postAccount(req('POST', '/api/orgs/org-acme/accounts', { name: 'Main' }), ctx())
    expect(res.status).toBe(400)
    expect(ledger.createAccount).not.toHaveBeenCalled()
  })

  it('patchAccount answers 200 with the account', async () => {
    vi.mocked(ledger.updateAccount).mockResolvedValue(ACCOUNT as never)
    const res = await patchAccount(req('PATCH', '/api/orgs/org-acme/accounts/a1', { name: 'New' }), ctx({ accountId: 'a1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ account: ACCOUNT })
    expect(ledger.updateAccount).toHaveBeenCalledWith('org-acme', 'user-alice', 'a1', { name: 'New' })
  })

  it('patchAccount answers 404 for an id with a dot', async () => {
    const res = await patchAccount(req('PATCH', '/api/orgs/org-acme/accounts/a.b', { name: 'New' }), ctx({ accountId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(ledger.updateAccount).not.toHaveBeenCalled()
  })

  it('patchOrg answers 200 with the organization', async () => {
    vi.mocked(ledger.updateOrganization).mockResolvedValue({ name: 'New', currency: 'PLN' })
    const res = await patchOrg(req('PATCH', '/api/orgs/org-acme', { name: 'New' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ organization: { name: 'New', currency: 'PLN' } })
    expect(ledger.updateOrganization).toHaveBeenCalledWith('org-acme', 'user-alice', { name: 'New' })
  })
})

describe('POST /ledger/rebuild', () => {
  const REPORT = { applied: false, ok: true }

  it('defaults to a dry run', async () => {
    vi.mocked(ledger.rebuild).mockResolvedValue(REPORT as never)
    const res = await rebuild(req('POST', '/api/orgs/org-acme/ledger/rebuild'), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ report: REPORT })
    expect(ledger.rebuild).toHaveBeenCalledWith('org-acme', 'user-alice', false)
  })

  it('apply=0 is a dry run', async () => {
    vi.mocked(ledger.rebuild).mockResolvedValue(REPORT as never)
    await rebuild(req('POST', '/api/orgs/org-acme/ledger/rebuild?apply=0'), ctx())
    expect(ledger.rebuild).toHaveBeenCalledWith('org-acme', 'user-alice', false)
  })

  it('apply=1 applies', async () => {
    vi.mocked(ledger.rebuild).mockResolvedValue(REPORT as never)
    await rebuild(req('POST', '/api/orgs/org-acme/ledger/rebuild?apply=1'), ctx())
    expect(ledger.rebuild).toHaveBeenCalledWith('org-acme', 'user-alice', true)
  })

  it.each(['?apply=2', '?x=1', '?apply=1&x=1', '?apply=', '?apply=1&apply=0'])('answers 400 invalid_params for %s', async (query) => {
    const res = await rebuild(req('POST', `/api/orgs/org-acme/ledger/rebuild${query}`), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_params' })
    expect(ledger.rebuild).not.toHaveBeenCalled()
  })
})

describe('error mapping', () => {
  async function createWith(error: unknown): Promise<Response> {
    vi.mocked(ledger.createTransaction).mockRejectedValue(error)
    return postTx(req('POST', '/api/orgs/org-acme/transactions', BODY_TX), ctx())
  }

  it('maps ledger_busy to 409', async () => {
    const res = await createWith(new LedgerError('ledger_busy'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'ledger_busy' })
  })

  it('maps future_actual to 422', async () => {
    const res = await createWith(new LedgerError('future_actual', 'paymentDate'))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'future_actual' })
  })

  it('maps an FX provider outage to 503', async () => {
    const res = await createWith(new FxError('provider_unavailable'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'provider_unavailable' })
  })

  it('maps an unexpected error to a generic 500', async () => {
    const res = await createWith(new Error('boom'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})
