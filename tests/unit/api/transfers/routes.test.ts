import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { transfers } from '@/lib/server/transfers'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { POST as runRoute } from '@/app/api/orgs/[orgId]/transfers/route'
import { GET as suggestionsRoute } from '@/app/api/orgs/[orgId]/transfers/suggestions/route'
import { POST as splitRoute } from '@/app/api/orgs/[orgId]/transfers/[txId]/split/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/transfers', () => ({
  transfers: { suggestions: vi.fn(), run: vi.fn(), split: vi.fn() },
}))

const V = '1790000000.000000001'

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

type Call = { name: string; mock: keyof typeof transfers; call: (token: string | null) => Promise<Response> }

const READ: Call = { name: 'GET /transfers/suggestions', mock: 'suggestions', call: (t) => suggestionsRoute(req('GET', '/api/orgs/org-acme/transfers/suggestions', undefined, t), ctx()) }
const WRITES: Call[] = [
  { name: 'POST /transfers', mock: 'run', call: (t) => runRoute(req('POST', '/api/orgs/org-acme/transfers', { merge: ['bk_a1', 'bk_b1'] }, t), ctx()) },
  { name: 'POST /transfers/{id}/split', mock: 'split', call: (t) => splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split', undefined, t), ctx({ txId: 'bk_a1' })) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(transfers)) vi.mocked(fn).mockReset()
  vi.mocked(transfers.suggestions).mockResolvedValue({ pairs: [], total: 0, ambiguous: 0, truncated: false })
  vi.mocked(transfers.run).mockResolvedValue([])
  vi.mocked(transfers.split).mockResolvedValue({ restored: [] })
})

describe('authorization of every transfer route', () => {
  describe.each([READ, ...WRITES])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(transfers[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(transfers[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(WRITES.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(transfers[mock]).not.toHaveBeenCalled()
  })
})

describe('GET /transfers/suggestions', () => {
  it('lets a viewer read the suggestions, not cached', async () => {
    const result = { pairs: [], total: 3, ambiguous: 1, truncated: true }
    vi.mocked(transfers.suggestions).mockResolvedValue(result)
    const res = await suggestionsRoute(req('GET', '/api/orgs/org-acme/transfers/suggestions', undefined, 'token-dave'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(result)
    expect(transfers.suggestions).toHaveBeenCalledWith('org-acme')
  })
})

describe('POST /transfers', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('runs the parsed request for %s and answers the results', async (name, uid) => {
    const results = [{ ids: ['bk_a1', 'bk_b1'], ok: false as const, code: 'not_eligible' }]
    vi.mocked(transfers.run).mockResolvedValue(results)
    const body = { pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: [V, V] }] }
    const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', body, `token-${name}`), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ results })
    expect(transfers.run).toHaveBeenCalledWith('org-acme', uid, { kind: 'pairs', pairs: [{ ids: ['bk_a1', 'bk_b1'], versions: [V, V] }] })
  })

  it('answers 400 for an unusable body and does not run anything', async () => {
    for (const body of [{}, { merge: ['a/b', 'c'] }, { convert: { ids: [], toAccountId: 'cash' } }]) {
      const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', body), ctx())
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_input' })
    }
    expect(transfers.run).not.toHaveBeenCalled()
  })

  it('answers 413 for a body over 64 KB', async () => {
    const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', JSON.stringify({ convert: { ids: ['a'], toAccountId: 'x'.repeat(70_000) } })), ctx())
    expect(res.status).toBe(413)
    expect(transfers.run).not.toHaveBeenCalled()
  })
})

describe('POST /transfers/{id}/split', () => {
  it('splits and answers the restored operations', async () => {
    const restored = [{ id: 'bk_a1' }, { id: 'bk_b1' }]
    vi.mocked(transfers.split).mockResolvedValue({ restored } as never)
    const res = await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split', undefined, 'token-carol'), ctx({ txId: 'bk_a1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ restored })
    expect(transfers.split).toHaveBeenCalledWith('org-acme', 'user-carol', 'bk_a1')
  })

  it('answers 404 for an id that is not a safe document id, and maps the ledger refusals', async () => {
    expect((await splitRoute(req('POST', '/api/orgs/org-acme/transfers/a.b/split'), ctx({ txId: 'a.b' }))).status).toBe(404)
    vi.mocked(transfers.split).mockRejectedValue(new LedgerError('not_eligible'))
    const res = await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split'), ctx({ txId: 'bk_a1' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'not_eligible' })
    vi.mocked(transfers.split).mockRejectedValue(new LedgerError('conflict'))
    expect((await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split'), ctx({ txId: 'bk_a1' }))).status).toBe(409)
  })
})
