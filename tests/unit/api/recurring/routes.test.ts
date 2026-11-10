import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { recurring } from '@/lib/server/recurring'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET as overviewRoute, POST as createRoute } from '@/app/api/orgs/[orgId]/recurring/route'
import { DELETE as deleteRoute, GET as seriesRoute, PATCH as patchRoute } from '@/app/api/orgs/[orgId]/recurring/[seriesId]/route'
import { POST as skipRoute } from '@/app/api/orgs/[orgId]/recurring/[seriesId]/skip/route'
import { GET as suggestionsRoute } from '@/app/api/orgs/[orgId]/recurring/suggestions/route'
import { POST as matchesRoute } from '@/app/api/orgs/[orgId]/recurring/matches/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/recurring', () => ({
  recurring: {
    overview: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), skip: vi.fn(), suggestions: vi.fn(), matches: vi.fn(), cron: vi.fn(),
  },
}))

const SERIES = 'abcdefghij0123456789'
const PLAN = `pl_${SERIES}_2026-11-10`
const BANK = `bk_${'a'.repeat(32)}`
const V = '1790000000.000000001'
const BODY = { name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01' }
const base = '/api/orgs/org-acme/recurring'

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
const ctx = <T extends Record<string, string> = Record<never, never>>(extra?: T) => ({
  params: Promise.resolve({ orgId: 'org-acme', ...extra } as { orgId: string } & T),
})
const one = () => ctx({ seriesId: SERIES })

type Call = { name: string; mock: keyof typeof recurring; call: (token: string | null) => Promise<Response> }
const READS: Call[] = [
  { name: 'GET /recurring', mock: 'overview', call: (t) => overviewRoute(req('GET', base, undefined, t), ctx()) },
  { name: 'GET /recurring/{id}', mock: 'get', call: (t) => seriesRoute(req('GET', `${base}/${SERIES}`, undefined, t), one()) },
  { name: 'GET /recurring/suggestions', mock: 'suggestions', call: (t) => suggestionsRoute(req('GET', `${base}/suggestions`, undefined, t), ctx()) },
]
const WRITES: Call[] = [
  { name: 'POST /recurring', mock: 'create', call: (t) => createRoute(req('POST', base, BODY, t), ctx()) },
  { name: 'PATCH /recurring/{id}', mock: 'update', call: (t) => patchRoute(req('PATCH', `${base}/${SERIES}`, { amountMinor: 1 }, t), one()) },
  { name: 'DELETE /recurring/{id}', mock: 'remove', call: (t) => deleteRoute(req('DELETE', `${base}/${SERIES}`, undefined, t), one()) },
  { name: 'POST /recurring/{id}/skip', mock: 'skip', call: (t) => skipRoute(req('POST', `${base}/${SERIES}/skip`, { occurrence: '2026-11-10' }, t), one()) },
  { name: 'POST /recurring/matches', mock: 'matches', call: (t) => matchesRoute(req('POST', `${base}/matches`, { undo: [PLAN] }, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(recurring)) vi.mocked(fn).mockReset()
  vi.mocked(recurring.overview).mockResolvedValue({ series: [], overdueCount: 0, overdue: [], upcoming: [], soon: { income: [], expense: [] }, truncated: false })
  vi.mocked(recurring.get).mockResolvedValue(null)
  vi.mocked(recurring.suggestions).mockResolvedValue({ pairs: [], total: 0, ambiguous: 0, truncated: false })
  vi.mocked(recurring.create).mockResolvedValue({ series: { id: SERIES } as never, created: 3 })
  vi.mocked(recurring.update).mockResolvedValue({ series: { id: SERIES } as never, created: 0, updated: 1, deleted: 0 })
  vi.mocked(recurring.remove).mockResolvedValue({ deleted: 2 })
  vi.mocked(recurring.skip).mockResolvedValue({ id: PLAN } as never)
  vi.mocked(recurring.matches).mockResolvedValue([])
})

describe('authorization of every recurring route', () => {
  describe.each([...READS, ...WRITES])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(recurring[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(recurring[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(WRITES.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(recurring[mock]).not.toHaveBeenCalled()
  })

  it.each(READS.filter((r) => r.mock !== 'get').map((r) => [r.name, r] as const))('%s lets a viewer read, not cached', async (_name, { call }) => {
    const res = await call('token-dave')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST /recurring', () => {
  it('creates a series from a valid body: 201 with the number of plans', async () => {
    const res = await createRoute(req('POST', base, BODY), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ series: { id: SERIES }, created: 3 })
    expect(recurring.create).toHaveBeenCalledWith('org-acme', 'user-alice', expect.objectContaining({ name: 'Czynsz', dayOfMonth: 10, weekendRule: 'none' }))
  })

  it('answers 400 with the field for an invalid body and 413 above 64 KB', async () => {
    const bad = await createRoute(req('POST', base, { ...BODY, dayOfMonth: 32 }), ctx())
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_input', field: 'dayOfMonth' })
    expect((await createRoute(req('POST', base, { ...BODY, description: 'x'.repeat(70_000) }), ctx())).status).toBe(413)
    expect(recurring.create).not.toHaveBeenCalled()
  })

  it('maps the limit and a refused reference', async () => {
    vi.mocked(recurring.create).mockRejectedValueOnce(new RecurringError('limit_reached'))
    expect((await createRoute(req('POST', base, BODY), ctx())).status).toBe(409)
    vi.mocked(recurring.create).mockRejectedValueOnce(new LedgerError('category_not_found', 'categoryId'))
    const res = await createRoute(req('POST', base, BODY), ctx())
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'category_not_found' })
  })
})

describe('the routes of one series', () => {
  it('GET answers 404 for an unknown series and for an id that cannot be one', async () => {
    expect((await seriesRoute(req('GET', `${base}/${SERIES}`), one())).status).toBe(404)
    expect((await seriesRoute(req('GET', `${base}/a.b`), ctx({ seriesId: 'a.b' }))).status).toBe(404)
    expect(recurring.get).toHaveBeenCalledTimes(1)
  })

  it('PATCH passes the parsed change; a bad id is 404, a bad body 400', async () => {
    expect((await patchRoute(req('PATCH', `${base}/${SERIES}`, { status: 'paused', removeFuture: true }), one())).status).toBe(200)
    expect(recurring.update).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, { changes: {}, status: 'paused', removeFuture: true })
    expect((await patchRoute(req('PATCH', `${base}/a.b`, { name: 'x' }), ctx({ seriesId: 'a.b' }))).status).toBe(404)
    expect((await patchRoute(req('PATCH', `${base}/${SERIES}`, { kind: 'income' }), one())).status).toBe(400)
  })

  it('DELETE reads from the query what happens to the future plans', async () => {
    expect((await deleteRoute(req('DELETE', `${base}/${SERIES}?future=keep`), one())).status).toBe(200)
    expect(recurring.remove).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, 'keep')
    expect((await deleteRoute(req('DELETE', `${base}/${SERIES}?future=maybe`), one())).status).toBe(400)
  })

  it('skip passes the occurrence and answers the plan as it was', async () => {
    const res = await skipRoute(req('POST', `${base}/${SERIES}/skip`, { occurrence: '2026-11-10' }), one())
    expect(await res.json()).toEqual({ before: { id: PLAN } })
    expect(recurring.skip).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, '2026-11-10')
  })
})

describe('POST /recurring/matches', () => {
  it('passes a parsed confirmation and answers a result per pair', async () => {
    vi.mocked(recurring.matches).mockResolvedValueOnce([{ planId: PLAN, ok: true, bankId: BANK }])
    const res = await matchesRoute(req('POST', `${base}/matches`, { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] }), ctx())
    expect(await res.json()).toEqual({ results: [{ planId: PLAN, ok: true, bankId: BANK }] })
    expect(recurring.matches).toHaveBeenCalledWith('org-acme', 'user-alice', { kind: 'confirm', items: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })
  })

  it('answers 400 for a bad body', async () => {
    expect((await matchesRoute(req('POST', `${base}/matches`, { pairs: [] }), ctx())).status).toBe(400)
  })
})
