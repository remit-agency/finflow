import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { HttpError } from '@/lib/server/http-error'
import { counterparties } from '@/lib/server/counterparties'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { POST as postCounterparty } from '@/app/api/orgs/[orgId]/counterparties/route'
import { PATCH as patchCounterparty } from '@/app/api/orgs/[orgId]/counterparties/[counterpartyId]/route'
import { GET as lookup } from '@/app/api/orgs/[orgId]/counterparties/lookup/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/counterparties', () => ({
  counterparties: { create: vi.fn(), update: vi.fn(), lookup: vi.fn() },
}))

const NRB = '61109010140000071219812874'
const CP = { id: 'c1', name: 'Acme', ibans: [], archived: false }

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

type Call = { name: string; mock: keyof typeof counterparties; call: (token: string | null) => Promise<Response> }

const ROUTES: Call[] = [
  { name: 'post', mock: 'create', call: (t) => postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'Acme' }, t), ctx()) },
  { name: 'patch', mock: 'update', call: (t) => patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true }, t), ctx({ counterpartyId: 'c1' })) },
  { name: 'lookup', mock: 'lookup', call: (t) => lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454', undefined, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(counterparties)) vi.mocked(fn).mockReset()
})

describe('authorization of every counterparty route', () => {
  describe.each(ROUTES)('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a viewer', async () => {
      expect((await call('token-dave')).status).toBe(403)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })
  })
})

describe('POST /counterparties', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('creates for %s with 201 and passes the parsed input', async (name, uid) => {
    vi.mocked(counterparties.create).mockResolvedValue(CP as never)
    const res = await postCounterparty(
      req('POST', '/api/orgs/org-acme/counterparties', { name: ' Acme ', nip: '774-000-14-54', ibans: ['PL61 1090 1014 0000 0712 1981 2874'] }, `token-${name}`),
      ctx(),
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ counterparty: CP })
    expect(counterparties.create).toHaveBeenCalledWith('org-acme', uid, { name: 'Acme', nip: '7740001454', ibans: [NRB] })
  })

  it('answers 400 with the field for an invalid NIP and does not call the service', async () => {
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'A', nip: '123' }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'nip', error: 'invalid_input' })
    expect(counterparties.create).not.toHaveBeenCalled()
  })

  it('answers 409 duplicate with the field and the existing id', async () => {
    vi.mocked(counterparties.create).mockRejectedValue(new CounterpartyError('duplicate', { field: 'nip', existingId: 'c9' }))
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'A', nip: '7740001454' }), ctx())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ field: 'nip', existingId: 'c9', error: 'duplicate' })
  })

  it('answers 413 for a body over 4 KB and 400 invalid_body for text that is not JSON', async () => {
    expect((await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', JSON.stringify({ name: 'x'.repeat(5000) })), ctx())).status).toBe(413)
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', '{nope'), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })
})

describe('PATCH /counterparties/{id}', () => {
  it('passes the parsed patch and answers 200', async () => {
    vi.mocked(counterparties.update).mockResolvedValue({ ...CP, archived: true } as never)
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true, nip: null }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counterparty: { ...CP, archived: true } })
    expect(counterparties.update).toHaveBeenCalledWith('org-acme', 'user-alice', 'c1', { archived: true, nip: null })
  })

  it('answers 404 for an id that is not a safe document id', async () => {
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/a.b', { archived: true }), ctx({ counterpartyId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(counterparties.update).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty patch and for a field it does not know', async () => {
    expect((await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', {}), ctx({ counterpartyId: 'c1' }))).status).toBe(400)
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { kind: 'zus' }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'kind', error: 'invalid_input' })
  })

  it('answers 404 when the service says the counterparty is gone', async () => {
    vi.mocked(counterparties.update).mockRejectedValue(new CounterpartyError('not_found'))
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(404)
  })
})

describe('GET /counterparties/lookup', () => {
  const ANSWER = { found: true, name: 'ORLEN', vatStatus: 'active', ibans: [NRB], checkedOn: '2026-10-27' }

  it('looks the normalised NIP up for the caller and answers 200 with no-store', async () => {
    vi.mocked(counterparties.lookup).mockResolvedValue(ANSWER as never)
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=PL%20774-000-14-54'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(ANSWER)
    expect(counterparties.lookup).toHaveBeenCalledWith('user-alice', '7740001454')
  })

  it.each([
    ['/api/orgs/org-acme/counterparties/lookup', 'nothing'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=123', 'a bad NIP'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=7740001454&x=1', 'an extra parameter'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=7740001454&nip=7740001454', 'a repeated parameter'],
  ])('answers 400 for %s', async (path) => {
    const res = await lookup(req('GET', path), ctx())
    expect(res.status).toBe(400)
    expect(counterparties.lookup).not.toHaveBeenCalled()
  })

  it('answers 429 when the caller is over the limit', async () => {
    vi.mocked(counterparties.lookup).mockRejectedValue(new HttpError(429, 'rate_limited'))
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454'), ctx())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })

  it('answers 502 when the white list cannot be reached', async () => {
    vi.mocked(counterparties.lookup).mockRejectedValue(new CounterpartyError('lookup_unavailable'))
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454'), ctx())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'lookup_unavailable' })
  })
})
