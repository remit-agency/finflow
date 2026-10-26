import { describe, expect, it } from 'vitest'
import { connectErrorKey } from '@/lib/enablebanking/errors'

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
