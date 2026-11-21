import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readExportPage } from '@/lib/server/export/read'
import { auditCol } from '@/lib/server/ledger/paths'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET, POST } from '@/app/api/orgs/[orgId]/export/data/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/rate-limit-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/rate-limit-guard')>('@/lib/server/rate-limit-guard')
  return { ...actual, enforceRateLimit: vi.fn(async () => {}) }
})
vi.mock('@/lib/server/export/read', () => ({ readExportPage: vi.fn() }))
vi.mock('@/lib/server/ledger/paths', () => ({ auditCol: vi.fn() }))

const create = vi.fn(async () => {})
const ctx = () => ({ params: Promise.resolve({ orgId: 'org-acme' }) })
function req(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
const url = '/api/orgs/org-acme/export/data'

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  create.mockClear()
  vi.mocked(readExportPage).mockReset().mockResolvedValue({ docs: [{ id: 'a', data: {} }], next: null })
  vi.mocked(auditCol).mockReset().mockReturnValue({ doc: () => ({ create }) } as unknown as ReturnType<typeof auditCol>)
})

describe('export data routes', () => {
  it('only the verified owner may read or record; everyone else is refused before any data is read', async () => {
    // carol: accountant, dave: viewer, mallory: no company, bob: unverified email, none: no cookie.
    const refusals: Array<[string | null, number]> = [['token-carol', 403], ['token-dave', 403], ['token-mallory', 403], ['token-bob', 403], [null, 401]]
    for (const [token, status] of refusals) {
      expect((await GET(req('GET', `${url}?collection=transactions`, token), ctx())).status, `GET ${token}`).toBe(status)
      expect((await POST(req('POST', url, token, { counts: { tags: 1 } }), ctx())).status, `POST ${token}`).toBe(status)
    }
    expect(readExportPage).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('GET returns one page of the asked collection, uncached, and refuses an unknown collection', async () => {
    const ok = await GET(req('GET', `${url}?collection=transactions&after=c1`, 'token-alice'), ctx())
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(await ok.json()).toEqual({ docs: [{ id: 'a', data: {} }], next: null })
    expect(vi.mocked(readExportPage).mock.calls[0].slice(1)).toEqual(['org-acme', 'transactions', 'c1'])
    expect((await GET(req('GET', `${url}?collection=rollups`, 'token-alice'), ctx())).status).toBe(400)
  })

  it('POST writes exactly one data.export audit entry holding the counts and nothing else', async () => {
    const res = await POST(req('POST', url, 'token-alice', { counts: { transactions: 4, tags: 0 } }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(vi.mocked(create).mock.calls[0]).toMatchObject([{ uid: 'user-alice', action: 'data.export', targetId: 'org-acme', before: null, after: { counts: { transactions: 4, tags: 0 } } }])
  })

  it('POST refuses counts that are not a known collection with a non-negative integer', async () => {
    for (const counts of [{ rollups: 1 }, { tags: -1 }, { tags: 1.5 }, { tags: '1' }, 'x']) {
      expect((await POST(req('POST', url, 'token-alice', { counts }), ctx())).status, JSON.stringify(counts)).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
  })
})
