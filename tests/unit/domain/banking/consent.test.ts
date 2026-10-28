import { describe, expect, it } from 'vitest'
import { consentNotice } from '@/lib/domain/banking/consent'

describe('consentNotice (days are Warsaw calendar days)', () => {
  it.each([
    ['2026-11-30', '2026-10-28', { kind: 'none' }],
    ['2026-11-01', '2026-10-28', { kind: 'none' }], // 4 days left: still quiet
    ['2026-10-31', '2026-10-28', { kind: 'days', days: 3 }],
    ['2026-10-30', '2026-10-28', { kind: 'days', days: 2 }],
    ['2026-10-29', '2026-10-28', { kind: 'days', days: 1 }],
    ['2026-10-28', '2026-10-28', { kind: 'today' }],
    ['2026-10-27', '2026-10-28', { kind: 'expired' }],
    ['2026-01-01', '2026-10-28', { kind: 'expired' }],
  ])('valid until %s, today %s -> %j', (validUntil, today, expected) => {
    expect(consentNotice(validUntil, today)).toEqual(expected)
  })

  it('works across a month and a year boundary', () => {
    expect(consentNotice('2027-01-01', '2026-12-30')).toEqual({ kind: 'days', days: 2 })
  })
})
