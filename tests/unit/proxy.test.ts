import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { HttpError } from '@/lib/server/http-error'
import { proxy } from '@/proxy'

const auth = vi.hoisted(() => ({ isSessionCookieValid: vi.fn() }))
vi.mock('@/lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/auth')>()),
  isSessionCookieValid: auth.isSessionCookieValid,
}))

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie: `__session=${cookie}` } : {},
  })
}

const isNext = (res: Response) => res.headers.get('x-middleware-next') === '1'

beforeEach(() => {
  auth.isSessionCookieValid.mockReset()
})

describe('proxy: public legal pages', () => {
  it.each(['/legal/terms', '/legal/privacy', '/legal/cookies'])('lets %s through with no cookie', async (path) => {
    const res = await proxy(request(path))

    expect(isNext(res)).toBe(true)
    expect(auth.isSessionCookieValid).not.toHaveBeenCalled()
  })
})

describe('proxy: app pages', () => {
  it('redirects to /login with the original path when there is no cookie, without verifying anything', async () => {
    const res = await proxy(request('/org1/transactions?month=2026-10'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?redirect=%2Forg1%2Ftransactions%3Fmonth%3D2026-10',
    )
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(auth.isSessionCookieValid).not.toHaveBeenCalled()
  })

  it('redirects and clears a cookie that fails verification (e.g. the old "1")', async () => {
    auth.isSessionCookieValid.mockResolvedValue(false)

    const res = await proxy(request('/org1/transactions', '1'))

    expect(auth.isSessionCookieValid).toHaveBeenCalledWith('1')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login?redirect=%2Forg1%2Ftransactions')
    expect(res.headers.get('set-cookie')).toBe('__session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('redirects to plain /login when the original path is not a safe return path', async () => {
    const res = await proxy(request('/org1/transactions?x=' + 'a'.repeat(600)))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(auth.isSessionCookieValid).not.toHaveBeenCalled()
  })

  it('lets a valid session through', async () => {
    auth.isSessionCookieValid.mockResolvedValue(true)

    const res = await proxy(request('/org1/settings', 'good'))

    expect(isNext(res)).toBe(true)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('answers 503 (and keeps the cookie) when verification fails on our side', async () => {
    auth.isSessionCookieValid.mockRejectedValue(new HttpError(503, 'auth unavailable'))

    const res = await proxy(request('/org1/settings', 'good'))

    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('retry-after')).toBe('5')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('also answers 503 when the server is not configured, and logs only a kind', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    auth.isSessionCookieValid.mockRejectedValue(new HttpError(500, 'server not configured'))

    const res = await proxy(request('/org1/settings', 'good'))

    expect(res.status).toBe(503)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(logged).toHaveBeenCalledWith('proxy: session check failed', expect.any(String))
    expect(JSON.stringify(logged.mock.calls)).not.toContain('server not configured')
  })
})

// Auth pages are never gated: a visitor holding a valid cookie but no Firebase SDK user (offline
// sign-out, revocation elsewhere, wiped storage) must still be able to reach the login page.
describe('proxy: auth pages', () => {
  const cases: Array<[string, string, string | undefined]> = []
  for (const path of ['/login', '/register']) {
    cases.push([path, 'a valid cookie', 'good'], [path, 'an invalid cookie', 'stale'], [path, 'no cookie', undefined])
  }

  it.each(cases)('passes %s through untouched with %s', async (path, _label, cookie) => {
    const res = await proxy(request(path, cookie))

    expect(isNext(res)).toBe(true)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(auth.isSessionCookieValid).not.toHaveBeenCalled()
  })
})

describe('proxy: other pages', () => {
  it.each(['/', '/pricing', '/forgot-password'])('does not verify anything on %s', async (path) => {
    const res = await proxy(request(path, 'whatever'))

    expect(isNext(res)).toBe(true)
    expect(auth.isSessionCookieValid).not.toHaveBeenCalled()
  })
})
