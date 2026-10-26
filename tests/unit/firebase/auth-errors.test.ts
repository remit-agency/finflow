import { describe, expect, it } from 'vitest'
import { CompaniesLoadError, authErrorKey, classifyAuthFailure } from '@/lib/firebase/auth-errors'
import { OrgCreateError } from '@/lib/firebase/orgs-client'

describe('authErrorKey', () => {
  it('maps Firebase codes to catalog slugs', () => {
    expect(authErrorKey({ code: 'auth/wrong-password' })).toBe('wrongPassword')
    expect(authErrorKey({ code: 'auth/popup-closed-by-user' })).toBe('popupClosed')
  })

  it('maps a failed companies read to its own slug, not the generic one', () => {
    expect(authErrorKey(new CompaniesLoadError())).toBe('loadCompanies')
  })

  it('falls back to generic', () => {
    expect(authErrorKey(new Error('boom'))).toBe('generic')
    expect(authErrorKey(null)).toBe('generic')
  })
})

describe('classifyAuthFailure', () => {
  it('keeps the company-creation code', () => {
    expect(classifyAuthFailure(new OrgCreateError('network'))).toEqual({ kind: 'orgCreate', code: 'network' })
  })

  it('classifies everything else as an auth failure', () => {
    expect(classifyAuthFailure(new CompaniesLoadError())).toEqual({ kind: 'auth', key: 'loadCompanies' })
  })
})
