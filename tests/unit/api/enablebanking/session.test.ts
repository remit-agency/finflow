import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEST_APP_URL,
  TEST_EB_STATE_SECRET,
  fakeAdmin,
  resetFakeAdmin,
  upstreamJson,
} from '@/tests/unit/helpers/fake-admin'
import { verifyEbState } from '@/lib/server/eb-state'
import { POST } from '@/app/api/enablebanking/session/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/enablebanking/jwt', () => ({ createJwt: vi.fn(async () => 'eb-jwt') }))

const fetchMock = vi.fn()

function sessionRequest(body: unknown, token?: string, origin = 'http://localhost:3000'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: origin }
  if (token) headers.Cookie = `__session=${token}`
  return new Request('http://localhost:3000/api/enablebanking/session', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const VALID_BODY = { aspspName: 'Mock ASPSP', aspspCountry: 'FI', orgId: 'org-acme' }

describe('POST /api/enablebanking/session', () => {
  let errorSpy: { mockRestore: () => void }

  beforeEach(() => {
    resetFakeAdmin()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('EB_STATE_SECRET', TEST_EB_STATE_SECRET)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', TEST_APP_URL)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns 401 without a session cookie and never calls Enable Banking', async () => {
    const res = await POST(sessionRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect(typeof (await res.json()).error).toBe('string')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 401 for a forged session cookie', async () => {
    const res = await POST(sessionRequest(VALID_BODY, 'token-forged'))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 email_not_verified for a signed-in user whose email is not verified', async () => {
    const res = await POST(sessionRequest(VALID_BODY, 'token-bob'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'email_not_verified' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 for a cross-origin request even with a valid session', async () => {
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice', 'https://evil.example'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when orgId is missing', async () => {
    const res = await POST(sessionRequest({ aspspName: 'Mock ASPSP' }, 'token-alice'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing params' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when aspspName is missing', async () => {
    const res = await POST(sessionRequest({ orgId: 'org-acme' }, 'token-alice'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing params' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed aspspCountry', async () => {
    const res = await POST(sessionRequest({ ...VALID_BODY, aspspCountry: 'pl;' }, 'token-alice'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid country' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed orgId and does not call Enable Banking', async () => {
    const res = await POST(sessionRequest({ ...VALID_BODY, orgId: '../x' }, 'token-alice'))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    const res = await POST(sessionRequest(VALID_BODY, 'token-mallory'))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['accountant', 'token-carol'],
    ['viewer', 'token-dave'],
  ])('returns 403 for a %s (bank connections are owner-only)', async (_role, token) => {
    const res = await POST(sessionRequest(VALID_BODY, token))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the org does not exist', async () => {
    const res = await POST(sessionRequest({ ...VALID_BODY, orgId: 'org-ghost' }, 'token-alice'))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts the authorization with a signed state and returns { url, authorizationId }', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamJson({
        url: 'https://auth.enablebanking.com/ais/start?sessionid=73100c65',
        authorization_id: '73100c65-c54d-46a1-87d1-aa3effde435a',
        psu_id_hash: 'abc',
      }),
    )

    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      url: 'https://auth.enablebanking.com/ais/start?sessionid=73100c65',
      authorizationId: '73100c65-c54d-46a1-87d1-aa3effde435a',
    })
    expect(fakeAdmin.auth.verifySessionCookie).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.enablebanking.com/auth')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer eb-jwt')
    const sent = JSON.parse(String(init.body))
    expect(sent.aspsp).toEqual({ name: 'Mock ASPSP', country: 'FI' })
    expect(sent.redirect_url).toBe(`${TEST_APP_URL}/api/enablebanking/callback`)
    expect(sent.psu_type).toBe('business')
    expect(sent.access.balances).toBe(true)
    expect(sent.access.transactions).toBe(true)
    expect(verifyEbState(sent.state, TEST_EB_STATE_SECRET)).toEqual({ orgId: 'org-acme', uid: 'user-alice' })
  })

  it('sends the psuType the owner chose (personal) as psu_type', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ url: 'https://x.test', authorization_id: 'a1' }))
    const res = await POST(sessionRequest({ ...VALID_BODY, psuType: 'personal' }, 'token-alice'))
    expect(res.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).psu_type).toBe('personal')
  })

  it('answers 400 "Missing params" for a psuType that is neither business nor personal', async () => {
    const res = await POST(sessionRequest({ ...VALID_BODY, psuType: 'government' }, 'token-alice'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing params' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults aspspCountry to PL', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ url: 'https://x.test', authorization_id: 'a1' }))
    await POST(sessionRequest({ aspspName: 'Bank Millennium', orgId: 'org-acme' }, 'token-alice'))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).aspsp).toEqual({ name: 'Bank Millennium', country: 'PL' })
  })

  it('maps an Enable Banking failure to 502 without leaking the upstream body', async () => {
    fetchMock.mockResolvedValueOnce(upstreamJson({ message: 'redirect_url not allowed' }, 422))
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'enable banking error' })
  })

  it('returns 500 "server not configured" when EB_STATE_SECRET is empty', async () => {
    vi.stubEnv('EB_STATE_SECRET', '')
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('in production, refuses to fall back to the request origin when NEXT_PUBLIC_APP_URL is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('in production, uses NEXT_PUBLIC_APP_URL when it is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    fetchMock.mockResolvedValueOnce(upstreamJson({ url: 'https://x.test', authorization_id: 'a1' }))
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))
    expect(res.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).redirect_url).toBe(`${TEST_APP_URL}/api/enablebanking/callback`)
  })

  it('outside production, falls back to the request origin when NEXT_PUBLIC_APP_URL is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    fetchMock.mockResolvedValueOnce(upstreamJson({ url: 'https://x.test', authorization_id: 'a1' }))
    const res = await POST(sessionRequest(VALID_BODY, 'token-alice'))
    expect(res.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).redirect_url).toBe('http://localhost:3000/api/enablebanking/callback')
  })
})
