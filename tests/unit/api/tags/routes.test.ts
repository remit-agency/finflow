import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TagError } from '@/lib/domain/tags/errors'
import { tags } from '@/lib/server/tags'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET as listRoute, POST as createRoute } from '@/app/api/orgs/[orgId]/tags/route'
import { PATCH as patchRoute } from '@/app/api/orgs/[orgId]/tags/[tagId]/route'
import { GET as impactRoute } from '@/app/api/orgs/[orgId]/tags/[tagId]/impact/route'
import { POST as recalcRoute } from '@/app/api/orgs/[orgId]/tags/[tagId]/recalculate/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/tags', () => ({
  tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), impact: vi.fn(), recalculate: vi.fn() },
}))

const TAG = { id: 'tg1', name: 'ПДВ', color: 'slate', excludeFromAnalytics: true, archived: false, recalcPending: false }

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

type Call = { name: string; mock: keyof typeof tags; call: (token: string | null) => Promise<Response> }

const LIST: Call = { name: 'GET /tags', mock: 'list', call: (t) => listRoute(req('GET', '/api/orgs/org-acme/tags', undefined, t), ctx()) }
const EDITS: Call[] = [
  { name: 'POST /tags', mock: 'create', call: (t) => createRoute(req('POST', '/api/orgs/org-acme/tags', { name: 'ПДВ' }, t), ctx()) },
  { name: 'PATCH /tags/{id}', mock: 'update', call: (t) => patchRoute(req('PATCH', '/api/orgs/org-acme/tags/tg1', { archived: true }, t), ctx({ tagId: 'tg1' })) },
  { name: 'GET /tags/{id}/impact', mock: 'impact', call: (t) => impactRoute(req('GET', '/api/orgs/org-acme/tags/tg1/impact', undefined, t), ctx({ tagId: 'tg1' })) },
  { name: 'POST /tags/{id}/recalculate', mock: 'recalculate', call: (t) => recalcRoute(req('POST', '/api/orgs/org-acme/tags/tg1/recalculate', {}, t), ctx({ tagId: 'tg1' })) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(tags)) vi.mocked(fn).mockReset()
  vi.mocked(tags.list).mockResolvedValue([])
})

describe('authorization of every tag route', () => {
  describe.each([LIST, ...EDITS])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(tags[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(tags[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(EDITS.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(tags[mock]).not.toHaveBeenCalled()
  })
})

describe('GET /tags', () => {
  it('lets a viewer read the list, not cached', async () => {
    vi.mocked(tags.list).mockResolvedValue([TAG] as never)
    const res = await listRoute(req('GET', '/api/orgs/org-acme/tags', undefined, 'token-dave'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ tags: [TAG] })
    expect(tags.list).toHaveBeenCalledWith('org-acme')
  })
})

describe('POST /tags', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('creates for %s with 201 and the parsed input', async (name, uid) => {
    vi.mocked(tags.create).mockResolvedValue(TAG as never)
    const res = await createRoute(req('POST', '/api/orgs/org-acme/tags', { name: '  ПДВ ', excludeFromAnalytics: true }, `token-${name}`), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ tag: TAG })
    expect(tags.create).toHaveBeenCalledWith('org-acme', uid, { name: 'ПДВ', color: 'slate', excludeFromAnalytics: true })
  })

  it('answers 400 with the field for invalid input and does not call the service', async () => {
    const res = await createRoute(req('POST', '/api/orgs/org-acme/tags', { name: '' }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'name', error: 'invalid_input' })
    expect(tags.create).not.toHaveBeenCalled()
  })

  it.each<[string, TagError, number, Record<string, unknown>]>([
    ['a taken name', new TagError('duplicate', { field: 'name', existingId: 'tg0' }), 409, { error: 'duplicate', field: 'name', existingId: 'tg0' }],
    ['the limit', new TagError('limit_reached'), 409, { error: 'limit_reached' }],
  ])('maps %s', async (_name, error, status, body) => {
    vi.mocked(tags.create).mockRejectedValue(error)
    const res = await createRoute(req('POST', '/api/orgs/org-acme/tags', { name: 'ПДВ' }), ctx())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
  })

  it('answers 413 for a body over 4 KB', async () => {
    const res = await createRoute(req('POST', '/api/orgs/org-acme/tags', JSON.stringify({ name: 'x'.repeat(5000) })), ctx())
    expect(res.status).toBe(413)
  })
})

describe('PATCH /tags/{id}', () => {
  it('passes the parsed patch and answers the tag and whether to recalculate', async () => {
    vi.mocked(tags.update).mockResolvedValue({ tag: { ...TAG, recalcPending: true }, recalc: true } as never)
    const res = await patchRoute(req('PATCH', '/api/orgs/org-acme/tags/tg1', { excludeFromAnalytics: true }), ctx({ tagId: 'tg1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tag: { ...TAG, recalcPending: true }, recalc: true })
    expect(tags.update).toHaveBeenCalledWith('org-acme', 'user-alice', 'tg1', { excludeFromAnalytics: true })
  })

  it('answers 404 for an id that is not a safe document id, 400 for an empty patch, 404 when the tag is gone', async () => {
    expect((await patchRoute(req('PATCH', '/api/orgs/org-acme/tags/a.b', { archived: true }), ctx({ tagId: 'a.b' }))).status).toBe(404)
    expect((await patchRoute(req('PATCH', '/api/orgs/org-acme/tags/tg1', {}), ctx({ tagId: 'tg1' }))).status).toBe(400)
    vi.mocked(tags.update).mockRejectedValue(new TagError('not_found'))
    const res = await patchRoute(req('PATCH', '/api/orgs/org-acme/tags/tg1', { archived: true }), ctx({ tagId: 'tg1' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('GET /tags/{id}/impact', () => {
  it('answers how many operations carry the tag', async () => {
    vi.mocked(tags.impact).mockResolvedValue(42)
    const res = await impactRoute(req('GET', '/api/orgs/org-acme/tags/tg1/impact', undefined, 'token-carol'), ctx({ tagId: 'tg1' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ operations: 42 })
    expect(tags.impact).toHaveBeenCalledWith('org-acme', 'tg1')
  })
})

describe('POST /tags/{id}/recalculate', () => {
  it('runs one step from the cursor and answers it', async () => {
    const step = { scanned: 100, changed: 7, done: false, cursor: 'tx-100' }
    vi.mocked(tags.recalculate).mockResolvedValue(step)
    const res = await recalcRoute(req('POST', '/api/orgs/org-acme/tags/tg1/recalculate', { cursor: 'tx-0' }), ctx({ tagId: 'tg1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(step)
    expect(tags.recalculate).toHaveBeenCalledWith('org-acme', 'user-alice', 'tg1', 'tx-0')
  })

  it('a first step has no cursor; a bad cursor is 400', async () => {
    vi.mocked(tags.recalculate).mockResolvedValue({ scanned: 0, changed: 0, done: true, cursor: null })
    await recalcRoute(req('POST', '/api/orgs/org-acme/tags/tg1/recalculate', {}), ctx({ tagId: 'tg1' }))
    expect(tags.recalculate).toHaveBeenCalledWith('org-acme', 'user-alice', 'tg1', null)
    expect((await recalcRoute(req('POST', '/api/orgs/org-acme/tags/tg1/recalculate', { cursor: 'a/b' }), ctx({ tagId: 'tg1' }))).status).toBe(400)
  })
})
