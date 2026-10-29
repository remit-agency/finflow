import { describe, expect, it } from 'vitest'
import { bankErrorKey, connectErrorKey } from '@/lib/enablebanking/errors'

describe('connectErrorKey', () => {
  it.each([
    [null, undefined, 'connectNetwork'],
    [403, 'email_not_verified', 'emailNotVerified'],
    [403, 'forbidden', 'connectForbidden'],
    [403, undefined, 'connectForbidden'],
    [400, 'Missing params', 'connectInvalid'],
    [429, undefined, 'connectUnavailable'],
    [502, 'enable banking error', 'connectUnavailable'],
    [503, undefined, 'connectUnavailable'],
    [504, undefined, 'connectUnavailable'],
    [500, 'internal', 'connect'],
    [404, undefined, 'connect'],
    [200, undefined, 'connect'],
  ] as const)('status %s with code %s is %s', (status, code, expected) => {
    expect(connectErrorKey(status, code)).toBe(expected)
  })
})

describe('bankErrorKey', () => {
  it.each([
    ['consent_expired', 'consentExpired'],
    ['rate_limited', 'rateLimited'],
    ['bank_unavailable', 'bankUnavailable'],
    ['bank_error', 'bankUnavailable'],
    ['currency_mismatch', 'currencyMismatch'],
    ['currency_unsupported', 'currencyUnsupported'],
    ['already_linked', 'alreadyLinked'],
    ['something_else', 'syncFailed'],
    ['', 'syncFailed'],
  ] as const)('server code %s is %s', (code, expected) => {
    expect(bankErrorKey(code)).toBe(expected)
  })

  it('uses the given fallback for an unknown code (linking says it could not link)', () => {
    expect(bankErrorKey('invalid_input', 'linkFailed')).toBe('linkFailed')
    expect(bankErrorKey('consent_expired', 'linkFailed')).toBe('consentExpired')
  })
})
