import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  buildClearedSessionCookie,
  buildSessionCookie,
  isSecureCookieEnv,
  readCookie,
  readSessionCookie,
} from '@/lib/server/session-cookie'

function headers(cookie?: string): Headers {
  const h = new Headers()
  if (cookie !== undefined) h.set('cookie', cookie)
  return h
}

describe('constants', () => {
  it('uses the __session name and a 7-day lifetime', () => {
    expect(SESSION_COOKIE_NAME).toBe('__session')
    expect(SESSION_MAX_AGE_SECONDS).toBe(604800)
  })
})

describe('readSessionCookie', () => {
  it('returns the value of __session', () => {
    expect(readSessionCookie(headers('__session=abc.def.ghi'))).toBe('abc.def.ghi')
  })

  it('finds it among other cookies and ignores whitespace', () => {
    expect(readSessionCookie(headers('theme=dark; __session=tok ; other=1'))).toBe('tok')
  })

  it('does not match a cookie whose name merely ends with __session', () => {
    expect(readSessionCookie(headers('x__session=nope'))).toBeNull()
  })

  it('does not match a cookie whose name merely starts with __session', () => {
    expect(readSessionCookie(headers('__session2=nope'))).toBeNull()
  })

  it('uses the first __session when the header repeats it', () => {
    expect(readSessionCookie(headers('__session=first; __session=second'))).toBe('first')
  })

  it('returns a quoted value as-is (the signature check rejects it later)', () => {
    expect(readSessionCookie(headers('__session="abc"'))).toBe('"abc"')
  })

  it.each([
    ['no Cookie header', undefined],
    ['an empty header', ''],
    ['other cookies only', 'a=1; b=2'],
    ['an empty value', '__session='],
    ['a segment without "="', '__session'],
  ])('returns null for %s', (_label, value) => {
    expect(readSessionCookie(headers(value))).toBeNull()
  })

  it('keeps "=" characters inside the value', () => {
    expect(readSessionCookie(headers('__session=a=b=='))).toBe('a=b==')
  })
})

describe('buildSessionCookie', () => {
  it('sets HttpOnly, SameSite=Lax, Path=/ and a 7-day Max-Age', () => {
    expect(buildSessionCookie('v', false)).toBe(
      '__session=v; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
    )
  })

  it('adds Secure when requested', () => {
    expect(buildSessionCookie('v', true)).toBe(
      '__session=v; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure',
    )
  })
})

describe('buildClearedSessionCookie', () => {
  it('expires the cookie immediately with matching attributes', () => {
    expect(buildClearedSessionCookie(false)).toBe('__session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
    expect(buildClearedSessionCookie(true)).toBe(
      '__session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    )
  })
})

describe('isSecureCookieEnv', () => {
  it('is true only in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSecureCookieEnv()).toBe(true)
    vi.stubEnv('NODE_ENV', 'development')
    expect(isSecureCookieEnv()).toBe(false)
    vi.stubEnv('NODE_ENV', 'test')
    expect(isSecureCookieEnv()).toBe(false)
  })

  it('drives the default of the builders', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(buildSessionCookie('v')).toContain('; Secure')
    expect(buildClearedSessionCookie()).toContain('; Secure')
  })
})

describe('readCookie', () => {
  it('any cookie by name; empty or missing is null', () => {
    expect(readCookie(headers('theme=dark; NEXT_LOCALE=pl; __session=tok'), 'NEXT_LOCALE')).toBe('pl')
    expect(readCookie(headers('NEXT_LOCALE='), 'NEXT_LOCALE')).toBeNull()
    expect(readCookie(headers(), 'NEXT_LOCALE')).toBeNull()
  })
})
