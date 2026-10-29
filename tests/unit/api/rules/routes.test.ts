import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuleError } from '@/lib/domain/rules/errors'
import { rules } from '@/lib/server/rules'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET as listRoute, POST as createRoute } from '@/app/api/orgs/[orgId]/rules/route'
import { DELETE as deleteRoute, PATCH as patchRoute } from '@/app/api/orgs/[orgId]/rules/[ruleId]/route'
import { POST as orderRoute } from '@/app/api/orgs/[orgId]/rules/order/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/rules', () => ({
  rules: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), order: vi.fn() },
}))

const BODY = { name: 'Paliwo', type: 'expense', conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }], actions: { categoryId: 'k-fuel' } }
const PARSED = { ...BODY, active: true }
const RULE = { id: 'r1', order: 0, createdAtMs: 0, ...PARSED }

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

type Call = { name: string; mock: keyof typeof rules; call: (token: string | null) => Promise<Response> }

const LIST: Call = { name: 'GET /rules', mock: 'list', call: (t) => listRoute(req('GET', '/api/orgs/org-acme/rules', undefined, t), ctx()) }
const WRITES: Call[] = [
  { name: 'POST /rules', mock: 'create', call: (t) => createRoute(req('POST', '/api/orgs/org-acme/rules', BODY, t), ctx()) },
  { name: 'PATCH /rules/{id}', mock: 'update', call: (t) => patchRoute(req('PATCH', '/api/orgs/org-acme/rules/r1', { active: false }, t), ctx({ ruleId: 'r1' })) },
  { name: 'DELETE /rules/{id}', mock: 'remove', call: (t) => deleteRoute(req('DELETE', '/api/orgs/org-acme/rules/r1', undefined, t), ctx({ ruleId: 'r1' })) },
  { name: 'POST /rules/order', mock: 'order', call: (t) => orderRoute(req('POST', '/api/orgs/org-acme/rules/order', { ids: ['r1'] }, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(rules)) vi.mocked(fn).mockReset()
  vi.mocked(rules.list).mockResolvedValue([])
})

describe('authorization of every rules route', () => {
  describe.each([LIST, ...WRITES])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(rules[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(rules[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(WRITES.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(rules[mock]).not.toHaveBeenCalled()
  })
})

describe('GET /rules', () => {
  it('lets a viewer read the list, in order with the unusable marks, not cached', async () => {
    vi.mocked(rules.list).mockResolvedValue([{ ...RULE, unusable: ['category'] }] as never)
    const res = await listRoute(req('GET', '/api/orgs/org-acme/rules', undefined, 'token-dave'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ rules: [{ ...RULE, unusable: ['category'] }] })
    expect(rules.list).toHaveBeenCalledWith('org-acme')
  })
})

describe('POST /rules', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('creates for %s with 201 and the parsed input', async (name, uid) => {
    vi.mocked(rules.create).mockResolvedValue(RULE as never)
    const res = await createRoute(req('POST', '/api/orgs/org-acme/rules', BODY, `token-${name}`), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ rule: RULE })
    expect(rules.create).toHaveBeenCalledWith('org-acme', uid, PARSED)
  })

  it('answers 400 with the field for invalid input and does not call the service', async () => {
    const res = await createRoute(req('POST', '/api/orgs/org-acme/rules', { ...BODY, conditions: [] }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'conditions', error: 'invalid_input' })
    expect(rules.create).not.toHaveBeenCalled()
  })

  it.each<[string, RuleError, number, Record<string, unknown>]>([
    ['the limit', new RuleError('limit_reached'), 409, { error: 'limit_reached' }],
    ['a missing category', new RuleError('category_not_found', 'actions.categoryId'), 422, { error: 'category_not_found', field: 'actions.categoryId' }],
    ['an archived counterparty', new RuleError('counterparty_archived', 'actions.counterpartyId'), 422, { error: 'counterparty_archived', field: 'actions.counterpartyId' }],
  ])('maps %s', async (_name, error, status, body) => {
    vi.mocked(rules.create).mockRejectedValue(error)
    const res = await createRoute(req('POST', '/api/orgs/org-acme/rules', BODY), ctx())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
  })

  it('answers 413 for a body over 64 KB', async () => {
    const res = await createRoute(req('POST', '/api/orgs/org-acme/rules', JSON.stringify({ ...BODY, name: 'x'.repeat(65 * 1024) })), ctx())
    expect(res.status).toBe(413)
  })
})

describe('PATCH /rules/{id}', () => {
  it('passes the parsed patch and answers the rule', async () => {
    vi.mocked(rules.update).mockResolvedValue({ ...RULE, active: false } as never)
    const res = await patchRoute(req('PATCH', '/api/orgs/org-acme/rules/r1', { active: false }), ctx({ ruleId: 'r1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rule: { ...RULE, active: false } })
    expect(rules.update).toHaveBeenCalledWith('org-acme', 'user-alice', 'r1', { active: false })
  })

  it('answers 404 for an id that is not a safe document id', async () => {
    const res = await patchRoute(req('PATCH', '/api/orgs/org-acme/rules/a.b', { active: false }), ctx({ ruleId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(rules.update).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty patch and 404 when the rule is gone', async () => {
    expect((await patchRoute(req('PATCH', '/api/orgs/org-acme/rules/r1', {}), ctx({ ruleId: 'r1' }))).status).toBe(400)
    vi.mocked(rules.update).mockRejectedValue(new RuleError('not_found'))
    const res = await patchRoute(req('PATCH', '/api/orgs/org-acme/rules/r1', { active: true }), ctx({ ruleId: 'r1' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('DELETE /rules/{id}', () => {
  it('deletes and answers 204', async () => {
    vi.mocked(rules.remove).mockResolvedValue(undefined)
    const res = await deleteRoute(req('DELETE', '/api/orgs/org-acme/rules/r1'), ctx({ ruleId: 'r1' }))
    expect(res.status).toBe(204)
    expect(rules.remove).toHaveBeenCalledWith('org-acme', 'user-alice', 'r1')
  })
})

describe('POST /rules/order', () => {
  it('passes the ids and answers 204', async () => {
    vi.mocked(rules.order).mockResolvedValue(undefined)
    const res = await orderRoute(req('POST', '/api/orgs/org-acme/rules/order', { ids: ['r2', 'r1'] }), ctx())
    expect(res.status).toBe(204)
    expect(rules.order).toHaveBeenCalledWith('org-acme', 'user-alice', ['r2', 'r1'])
  })

  it('answers 400 for repeated ids and 409 when the list is not the company rules', async () => {
    expect((await orderRoute(req('POST', '/api/orgs/org-acme/rules/order', { ids: ['r1', 'r1'] }), ctx())).status).toBe(400)
    vi.mocked(rules.order).mockRejectedValue(new RuleError('conflict'))
    const res = await orderRoute(req('POST', '/api/orgs/org-acme/rules/order', { ids: ['r1'] }), ctx())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict' })
  })
})
