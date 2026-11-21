import { describe, expect, it } from 'vitest'
import {
  isAppPath,
  isAuthPath,
  isLegalPath,
  isPublicPath,
  loginUrlAfterSessionLoss,
  safeRedirectPath,
} from '@/lib/auth/paths'

describe('isPublicPath', () => {
  it.each(['/login', '/register', '/forgot-password', '/login/extra'])('is true for %s', (p) => {
    expect(isPublicPath(p)).toBe(true)
  })
  it.each([
    '/',
    '/pricing',
    '/org1/transactions',
    '/login-foo',
    '/loginx/transactions',
    '/registerx',
    '/forgot-password2',
  ])('is false for %s', (p) => {
    expect(isPublicPath(p)).toBe(false)
  })
})

describe('isAuthPath', () => {
  it.each(['/login', '/register'])('is true for %s', (p) => expect(isAuthPath(p)).toBe(true))
  it.each(['/forgot-password', '/', '/org1/settings', '/login-foo', '/registerx'])('is false for %s', (p) => {
    expect(isAuthPath(p)).toBe(false)
  })
})

describe('isAppPath', () => {
  it.each([
    '/org1/transactions',
    '/Ab_c-9/settings',
    '/org1/analytics/cashflow',
    '/loginabc/transactions',
    '/register1/settings',
  ])('is true for %s', (p) => {
    expect(isAppPath(p)).toBe(true)
  })
  it.each([
    '/',
    '/login',
    '/login/x',
    '/register',
    '/forgot-password',
    '/pricing',
    '/org1',
    '//evil/x',
    '/legal/terms',
    '/legal/privacy',
    '/legal/cookies',
    '/legal/cookies/',
  ])('is false for %s', (p) => expect(isAppPath(p)).toBe(false))
  it.each(['/legal/other', '/legal/terms/x', '/legalx/terms', '/legal/Terms'])('is still an app path: %s', (p) => {
    expect(isAppPath(p)).toBe(true)
  })
})

describe('isLegalPath', () => {
  it.each(['/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/cookies/'])('is true for %s', (p) => {
    expect(isLegalPath(p)).toBe(true)
  })
  it.each(['/legal', '/legal/', '/legal/other', '/legal/terms/x', '/legalx/terms', '/org1/terms'])('is false for %s', (p) => {
    expect(isLegalPath(p)).toBe(false)
  })
})

describe('safeRedirectPath', () => {
  it.each([
    '/org1/settings',
    '/org1/settings/banks',
    '/org1/settings/banks?eb_error=1',
    '/org1/transactions?month=2026-10',
    '/',
    // Same-origin literal path (encoded slashes stay in one segment), not a protocol-relative URL.
    '/%2F%2Fevil.com',
  ])('accepts %s', (p) => {
    expect(safeRedirectPath(p)).toBe(p)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['relative without slash', 'org1/x'],
    ['protocol-relative', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['newline', '/a\nb'],
    ['NUL', '/a\u0000b'],
    ['API path', '/api/enablebanking/x'],
    ['bare /api', '/api'],
    ['dot segment onto API', '/./api/x'],
    ['parent segment onto API', '/foo/../api/x'],
    ['encoded dot segment onto API', '/%2e/api/x'],
    ['encoded letter in api', '/%61pi/x'],
    ['bare /api with query', '/api?x=1'],
    ['bare /api with hash', '/api#x'],
    ['too long', '/' + 'a'.repeat(600)],
    ['dot segment collapsing into //host', '/.//evil.example'],
    ['parent segment collapsing into //host', '/..//evil.example'],
    ['login page', '/login'],
    ['login page with query', '/login?redirect=%2Forg1%2Fsettings'],
    ['register page', '/register'],
    ['page under login', '/login/x'],
    ['encoded login page', '/%6Cogin'],
  ])('rejects %s', (_label, value) => {
    expect(safeRedirectPath(value as string | null | undefined)).toBeNull()
  })
})

describe('loginUrlAfterSessionLoss', () => {
  it('goes to a plain /login after a deliberate sign-out', () => {
    expect(
      loginUrlAfterSessionLoss({ justSignedOut: true, pathname: '/org1/transactions', search: '?month=2026-10' }),
    ).toBe('/login')
  })

  it('keeps the return path when an app page was loaded on an orphaned cookie', () => {
    expect(
      loginUrlAfterSessionLoss({ justSignedOut: false, pathname: '/org1/transactions', search: '?month=2026-10' }),
    ).toBe('/login?redirect=%2Forg1%2Ftransactions%3Fmonth%3D2026-10')
  })

  it('drops an unsafe return path', () => {
    expect(loginUrlAfterSessionLoss({ justSignedOut: false, pathname: '/api/x', search: '' })).toBe('/login')
  })
})
