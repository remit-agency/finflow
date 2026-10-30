import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '@/lib/domain/journal/order'
import { rules } from '@/lib/server/rules'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { POST as applyRoute } from '@/app/api/orgs/[orgId]/rules/apply/route'
import { POST as previewRoute } from '@/app/api/orgs/[orgId]/rules/preview/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/rules', () => ({
  rules: { preview: vi.fn(), check: vi.fn(), apply: vi.fn() },
}))

const RULE = { name: 'Paliwo', type: 'expense', conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }], actions: { categoryId: 'k-fuel' } }
const KEY = { paymentDate: '2026-10-20', createdAtS: 1_790_000_000, createdAtN: 0, id: 't1' }
const CHECKED = { scanned: 200, matchOps: 3, categories: 3, counterparties: 0, tags: 0, done: false, cursor: 'c1' }
const APPLIED = { scanned: 40, changed: 25, failed: 0, done: false, cursor: 'c2' }

function req(path: string, body: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const ctx = () => ({ params: Promise.resolve({ orgId: 'org-acme' }) })
const preview = (body: unknown, token?: string | null) => previewRoute(req('/api/orgs/org-acme/rules/preview', body, token), ctx())
const apply = (body: unknown, token?: string | null) => applyRoute(req('/api/orgs/org-acme/rules/apply', body, token), ctx())

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(rules)) vi.mocked(fn).mockReset()
})

describe.each([
  ['preview', () => preview({ rule: RULE }, null), () => preview({ rule: RULE }, 'token-mallory'), () => preview({ rule: RULE }, 'token-dave')],
  ['apply', () => apply({ mode: 'check' }, null), () => apply({ mode: 'check' }, 'token-mallory'), () => apply({ mode: 'check' }, 'token-dave')],
] as const)('authorization of %s', (_name, anonymous, stranger, viewer) => {
  it('401 without a session, 403 for a stranger and for a viewer, and nothing runs', async () => {
    expect((await anonymous()).status).toBe(401)
    expect((await stranger()).status).toBe(403)
    expect((await viewer()).status).toBe(403)
    for (const fn of Object.values(rules)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('POST /rules/preview', () => {
  it('passes the parsed draft rule and answers the counts', async () => {
    vi.mocked(rules.preview).mockResolvedValue({ matched: 2, scanned: 10, capped: false })
    const res = await preview({ rule: RULE })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ matched: 2, scanned: 10, capped: false })
    expect(rules.preview).toHaveBeenCalledWith('org-acme', { ...RULE, active: true })
  })

  it('answers 400 with the field for an invalid draft', async () => {
    const res = await preview({ rule: { ...RULE, actions: {} } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'actions', error: 'invalid_input' })
    expect(rules.preview).not.toHaveBeenCalled()
  })
})

describe('POST /rules/apply', () => {
  it('check: the first step has no cursor, a later one passes the decoded cursor', async () => {
    vi.mocked(rules.check).mockResolvedValue(CHECKED)
    const first = await apply({ mode: 'check' })
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.json()).toEqual(CHECKED)
    expect(rules.check).toHaveBeenLastCalledWith('org-acme', null)
    await apply({ mode: 'check', cursor: encodeCursor(KEY) })
    expect(rules.check).toHaveBeenLastCalledWith('org-acme', KEY)
    expect(rules.apply).not.toHaveBeenCalled()
  })

  it('apply: an accountant may apply, with the caller as the author of the changes', async () => {
    vi.mocked(rules.apply).mockResolvedValue(APPLIED)
    const res = await apply({ mode: 'apply', cursor: encodeCursor(KEY) }, 'token-carol')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(APPLIED)
    expect(rules.apply).toHaveBeenCalledWith('org-acme', 'user-carol', KEY)
  })

  it('answers 400 for an unknown mode or a broken cursor', async () => {
    expect((await apply({ mode: 'run' })).status).toBe(400)
    const res = await apply({ mode: 'apply', cursor: 'broken' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'cursor', error: 'invalid_input' })
    expect(rules.apply).not.toHaveBeenCalled()
  })
})
