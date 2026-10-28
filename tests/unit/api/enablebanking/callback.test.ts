import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_EB_STATE_SECRET, resetFakeAdmin, upstreamJson } from '@/tests/unit/helpers/fake-admin'
import { EB_STATE_TTL_SECONDS, signEbState } from '@/lib/server/eb-state'
import { GET } from '@/app/api/enablebanking/callback/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/enablebanking/jwt', () => ({ createJwt: vi.fn(async () => 'eb-jwt') }))
const bank = vi.hoisted(() => ({ getSession: vi.fn(), saveSession: vi.fn() }))
vi.mock('@/lib/server/banking', () => ({
  bankDeps: () => ({ eb: { getSession: bank.getSession } }),
  banking: { saveSession: bank.saveSession },
}))

const SESSION = {
  sessionId: 'sess-123',
  institutionName: 'Millennium',
  institutionCountry: 'PL',
  psuType: 'business',
  validUntil: '2027-01-21T10:00:00.000Z',
  accounts: [],
}

const fetchMock = vi.fn()

function callbackRequest(query: Record<string, string>, token: string | null = 'token-alice'): Request {
  const url = new URL('http://localhost:3000/api/enablebanking/callback')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new Request(url, { headers: token ? { Cookie: `__session=${token}` } : {} })
}

function aliceState(nowSec?: number): string {
  return signEbState({ orgId: 'org-acme', uid: 'user-alice' }, TEST_EB_STATE_SECRET, nowSec)
}

describe('GET /api/enablebanking/callback', () => {
  let errorSpy: { mockRestore: () => void }

  beforeEach(() => {
    resetFakeAdmin()
    fetchMock.mockReset()
    bank.getSession.mockReset().mockResolvedValue(SESSION)
    bank.saveSession.mockReset().mockResolvedValue({ connectionId: 'sess-123', relinked: 0, unlinked: 0 })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('EB_STATE_SECRET', TEST_EB_STATE_SECRET)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns 400 "invalid state" when state is missing', async () => {
    const res = await GET(callbackRequest({ code: 'auth-code' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid state' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for the legacy unsigned base64 state', async () => {
    const legacy = Buffer.from(JSON.stringify({ orgId: 'org-acme' })).toString('base64url')
    const res = await GET(callbackRequest({ code: 'auth-code', state: legacy }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid state' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a state forged with another secret, before exchanging the code', async () => {
    const forged = signEbState({ orgId: 'org-acme', uid: 'user-alice' }, 'attacker-secret')
    const res = await GET(callbackRequest({ code: 'auth-code', state: forged }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid state' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 "expired state" for a state older than 15 minutes', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - EB_STATE_TTL_SECONDS - 5
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState(issuedAt) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'expired state' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the user in the state is no longer a member, before exchanging the code', async () => {
    const state = signEbState({ orgId: 'org-acme', uid: 'user-mallory' }, TEST_EB_STATE_SECRET)
    const res = await GET(callbackRequest({ code: 'auth-code', state }, 'token-mallory'))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the user in the state is an accountant (bank connections are owner-only), before exchanging the code', async () => {
    const state = signEbState({ orgId: 'org-acme', uid: 'user-carol' }, TEST_EB_STATE_SECRET)
    const res = await GET(callbackRequest({ code: 'auth-code', state }, 'token-carol'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a forged state even without a session (state is verified first)', async () => {
    const forged = signEbState({ orgId: 'org-acme', uid: 'user-alice' }, 'attacker-secret')
    const res = await GET(callbackRequest({ code: 'auth-code', state: forged }, null))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid state' })
  })

  it.each([
    ['no session cookie', null],
    ['a forged session cookie', 'token-forged'],
  ])('redirects to /login (keeping the settings path) with %s, without exchanging the code', async (_label, token) => {
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }, token))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Forg-acme%2Fsettings%2Fbanks')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the session belongs to a different user than the state', async () => {
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }, 'token-mallory'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the org in the state no longer exists', async () => {
    const state = signEbState({ orgId: 'org-ghost', uid: 'user-alice' }, TEST_EB_STATE_SECRET)
    const res = await GET(callbackRequest({ code: 'auth-code', state }))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges the code, saves the session on the server and redirects to /{orgId}/settings/banks?eb_connected=1', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ session_id: 'sess-123', accounts: [] }))

    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('http://localhost:3000')
    expect(location.pathname).toBe('/org-acme/settings/banks')
    expect(location.searchParams.get('eb_connected')).toBe('1')
    expect(location.searchParams.has('eb_auth')).toBe(false)
    expect(location.href).not.toContain('sess-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.enablebanking.com/sessions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer eb-jwt')
    expect(JSON.parse(String(init.body))).toEqual({ code: 'auth-code' })

    expect(bank.getSession).toHaveBeenCalledWith('sess-123')
    expect(bank.saveSession).toHaveBeenCalledWith(expect.anything(), 'org-acme', 'user-alice', SESSION)
  })

  it('redirects with eb_error=1 and does not claim a connection when the save fails', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ session_id: 'sess-123', accounts: [] }))
    bank.saveSession.mockRejectedValueOnce(new Error('firestore down'))
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/org-acme/settings/banks?eb_error=1')
  })

  it('redirects with eb_error=1 when the session cannot be read from the bank', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ session_id: 'sess-123', accounts: [] }))
    bank.getSession.mockRejectedValueOnce(new Error('bank down'))
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/org-acme/settings/banks?eb_error=1')
    expect(bank.saveSession).not.toHaveBeenCalled()
  })

  it('redirects to settings with eb_error=1 when the bank returns no code (user cancelled)', async () => {
    const res = await GET(
      callbackRequest({ state: aliceState(), error: 'access_denied', error_description: 'Denied data sharing consent' }),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/org-acme/settings/banks?eb_error=1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sanitizes error / error_description before logging (no log forging)', async () => {
    errorSpy.mockRestore()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorSpy = log
    await GET(
      callbackRequest({
        state: aliceState(),
        error: 'access_denied\nFAKE LOG LINE: admin logged in',
        error_description: 'x\r\u0000\u001b[31m' + 'a'.repeat(500),
      }),
    )
    const logged = log.mock.calls.flat().filter((a): a is string => typeof a === 'string')
    expect(logged.length).toBeGreaterThan(0)
    for (const a of logged) {
      expect(a).not.toMatch(/[\u0000-\u001f\u007f]/)
    }
    expect(logged.join('|')).toContain('access_denied')
    expect(logged.some((a) => a.includes('a'.repeat(201)))).toBe(false)
  })

  it('redirects to settings with eb_error=1 when the code exchange fails', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ message: 'invalid code' }, 400))
    const res = await GET(callbackRequest({ code: 'auth-code', state: aliceState() }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/org-acme/settings/banks?eb_error=1')
  })

  it('returns 500 "server not configured" when EB_STATE_SECRET is empty', async () => {
    const state = aliceState()
    vi.stubEnv('EB_STATE_SECRET', '')
    const res = await GET(callbackRequest({ code: 'auth-code', state }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
