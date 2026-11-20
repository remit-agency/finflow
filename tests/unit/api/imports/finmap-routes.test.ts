import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { finmap } from '@/lib/server/imports/finmap'
import { POST as postCheck } from '@/app/api/orgs/[orgId]/imports/finmap/check/route'
import { POST as postSetup } from '@/app/api/orgs/[orgId]/imports/finmap/setup/route'
import { POST as postBatch } from '@/app/api/orgs/[orgId]/imports/finmap/batch/route'
import { POST as postFinish } from '@/app/api/orgs/[orgId]/imports/finmap/finish/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
// The Finmap services are replaced: these tests cover the routes (auth, body limits, parsing, the call and the headers).
vi.mock('@/lib/server/imports/finmap', () => ({
  finmap: { check: vi.fn(), setup: vi.fn(), batch: vi.fn(), finish: vi.fn() },
}))

const ORG = 'org-acme'
/** The uid of the fake session `token-alice` (an owner). */
const UID = 'user-alice'
const ctx = { params: Promise.resolve({ orgId: ORG }) }

function req(path: string, body: unknown, token: string | null = 'token-alice', rawBody?: string): Request {
  const headers: Record<string, string> = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method: 'POST', headers, body: rawBody ?? JSON.stringify(body) })
}

interface Case {
  name: string
  path: string
  post: (req: Request, ctx: { params: Promise<{ orgId: string }> }) => Promise<Response>
  valid: Record<string, unknown>
  /** A body that does not parse, and the field the 400 names. */
  bad: { body: Record<string, unknown>; field: string }
  service: Mock
  /** The arguments the service gets for a body (the uid is the session's). */
  expected: (body: Record<string, unknown>) => unknown[]
}

const CASES: Case[] = [
  {
    name: 'check',
    path: `/api/orgs/${ORG}/imports/finmap/check`,
    post: postCheck,
    valid: { operations: [] },
    bad: { body: {}, field: 'operations' },
    service: vi.mocked(finmap.check),
    expected: (body) => [ORG, body],
  },
  {
    name: 'setup',
    path: `/api/orgs/${ORG}/imports/finmap/setup`,
    post: postSetup,
    valid: { fileName: 'platnosci.xlsx', accounts: [], categories: [], counterparties: [], tags: [] },
    bad: { body: { accounts: [], categories: [], counterparties: [], tags: [] }, field: 'fileName' },
    service: vi.mocked(finmap.setup),
    expected: (body) => [ORG, UID, body],
  },
  {
    name: 'batch',
    path: `/api/orgs/${ORG}/imports/finmap/batch`,
    post: postBatch,
    valid: { importId: 'imp1', operations: [] },
    bad: { body: { importId: 'a/b', operations: [] }, field: 'importId' },
    service: vi.mocked(finmap.batch),
    expected: (body) => [ORG, UID, body],
  },
  {
    name: 'finish',
    path: `/api/orgs/${ORG}/imports/finmap/finish`,
    post: postFinish,
    valid: { importId: 'imp1' },
    bad: { body: {}, field: 'importId' },
    service: vi.mocked(finmap.finish),
    expected: (body) => [ORG, UID, body.importId],
  },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of [finmap.check, finmap.setup, finmap.batch, finmap.finish]) vi.mocked(fn).mockReset()
})

describe.each(CASES)('POST /api/orgs/{orgId}/imports/finmap/$name', (c) => {
  it('answers 401 without a session and calls no service', async () => {
    const res = await c.post(req(c.path, c.valid, null), ctx)
    expect(res.status).toBe(401)
    expect(c.service).not.toHaveBeenCalled()
  })

  it('answers 403 to a user who is not a member', async () => {
    const res = await c.post(req(c.path, c.valid, 'token-mallory'), ctx)
    expect(res.status).toBe(403)
    expect(c.service).not.toHaveBeenCalled()
  })

  it('answers 403 to a viewer (only owners and accountants import)', async () => {
    const res = await c.post(req(c.path, c.valid, 'token-dave'), ctx)
    expect(res.status).toBe(403)
    expect(c.service).not.toHaveBeenCalled()
  })

  it('answers 400 invalid_input naming the field of a body that does not parse', async () => {
    const res = await c.post(req(c.path, c.bad.body), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_input', field: c.bad.field })
    expect(c.service).not.toHaveBeenCalled()
  })

  it('answers 400 for text that is not JSON, and 413 for a body over the limit', async () => {
    const notJson = await c.post(req(c.path, undefined, 'token-alice', '{not json'), ctx)
    expect(notJson.status).toBe(400)
    const tooBig = await c.post(req(c.path, undefined, 'token-alice', JSON.stringify({ importId: 'x'.repeat(2 * 1024 * 1024) })), ctx)
    expect(tooBig.status).toBe(413)
    expect(c.service).not.toHaveBeenCalled()
  })

  it('passes an owner through to the service and answers 200 with no-store', async () => {
    c.service.mockResolvedValue({ ok: true })
    const res = await c.post(req(c.path, c.valid), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
    expect(c.service).toHaveBeenCalledWith(...c.expected(c.valid))
  })
})

describe('finish body limit', () => {
  it('refuses a finish body over 1 KB', async () => {
    const res = await postFinish(req(`/api/orgs/${ORG}/imports/finmap/finish`, undefined, 'token-alice', JSON.stringify({ importId: 'a'.repeat(1100) })), ctx)
    expect(res.status).toBe(413)
    expect(finmap.finish).not.toHaveBeenCalled()
  })
})
