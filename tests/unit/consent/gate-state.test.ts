import { describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import { gateStatus } from '@/lib/legal/consent'

const entry = (version: string) => ({ version, at: '2026-11-21T10:00:00.000Z', locale: 'pl' })

describe('gateStatus', () => {
  it('is loading until the first read answers', () => expect(gateStatus(undefined)).toBe('loading'))
  it('is unknown when the read failed (an offline browser must not lock a person out)', () =>
    expect(gateStatus('error')).toBe('unknown'))
  it('needs consent without a record', () => expect(gateStatus(null)).toBe('needed'))
  it('is ok when both documents are at the current version', () =>
    expect(gateStatus({ terms: entry(LEGAL_VERSIONS.terms), privacy: entry(LEGAL_VERSIONS.privacy) })).toBe('ok'))
  it('needs consent again when the terms version is old', () =>
    expect(gateStatus({ terms: entry('2020-01-01'), privacy: entry(LEGAL_VERSIONS.privacy) })).toBe('needed'))
})
