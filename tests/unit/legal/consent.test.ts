import { describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import { needsConsent, parseConsentBody, parseConsentState } from '@/lib/legal/consent'

const current = { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy }
const entry = (version: string) => ({ version, at: '2026-11-21T10:00:00.000Z', locale: 'pl' })

describe('needsConsent', () => {
  it('is true without a record', () => expect(needsConsent(null)).toBe(true))
  it('is true when one document is missing', () =>
    expect(needsConsent({ terms: entry(current.terms) })).toBe(true))
  it('is true when a version differs from the current one', () =>
    expect(needsConsent({ terms: entry('2020-01-01'), privacy: entry(current.privacy) })).toBe(true))
  it('is false when both documents are at the current version', () =>
    expect(needsConsent({ terms: entry(current.terms), privacy: entry(current.privacy) })).toBe(false))
})

describe('parseConsentState', () => {
  it('keeps only well-formed entries', () => {
    const state = parseConsentState({
      terms: entry('v1'),
      privacy: { version: 5, at: 'x', locale: 'pl' },
      junk: 1,
    })
    expect(state).toEqual({ terms: entry('v1') })
  })
  it('returns an empty state for non-objects', () => {
    expect(parseConsentState(null)).toEqual({})
    expect(parseConsentState('x')).toEqual({})
  })
})

describe('parseConsentBody', () => {
  it('accepts the current versions with a known source', () => {
    expect(parseConsentBody({ docs: current, source: 'gate' })).toEqual({ ok: true, value: { docs: current, source: 'gate' } })
  })
  it('reports stale when a version is not the current one', () => {
    expect(parseConsentBody({ docs: { ...current, terms: '2020-01-01' }, source: 'register' })).toEqual({ ok: false, reason: 'stale' })
  })
  it('reports invalid for a bad shape or source', () => {
    expect(parseConsentBody(null)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseConsentBody({ docs: current, source: 'hack' })).toEqual({ ok: false, reason: 'invalid' })
    expect(parseConsentBody({ docs: { terms: current.terms }, source: 'gate' })).toEqual({ ok: false, reason: 'invalid' })
  })
})
