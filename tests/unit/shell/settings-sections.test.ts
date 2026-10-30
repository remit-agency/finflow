import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTIONS,
  activeSettingsSection,
  canOpenSection,
  isSettingsPath,
  settingsIndexRedirect,
  settingsPath,
  visibleSettingsSections,
} from '@/lib/shell/settings-sections'

describe('isSettingsPath', () => {
  it.each(['/org1/settings', '/org1/settings/', '/org1/settings/company', '/org1/settings/banks/x'])(
    '%s is a settings path',
    (path) => {
      expect(isSettingsPath(path, 'org1')).toBe(true)
    },
  )

  it.each(['/org1/settingsx', '/org1/transactions', '/org2/settings/company', '/org1/analytics/settings', '/'])(
    '%s is not',
    (path) => {
      expect(isSettingsPath(path, 'org1')).toBe(false)
    },
  )

  it('matches an org id that needs encoding against the encoded pathname', () => {
    expect(isSettingsPath('/org%201/settings/banks', 'org 1')).toBe(true)
  })
})

describe('SETTINGS_SECTIONS', () => {
  it('lists the sections in menu order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.slug)).toEqual(['company', 'language', 'categories', 'counterparties', 'tags', 'rules', 'banks', 'subscription'])
  })
})

describe('settingsPath', () => {
  it('builds the section URL', () => {
    expect(settingsPath('org1', 'banks')).toBe('/org1/settings/banks')
  })

  it('encodes the org id', () => {
    expect(settingsPath('a b', 'company')).toBe('/a%20b/settings/company')
  })
})

describe('activeSettingsSection', () => {
  it.each([
    ['/org1/settings/company', 'company'],
    ['/org1/settings/language', 'language'],
    ['/org1/settings/categories', 'categories'],
    ['/org1/settings/counterparties', 'counterparties'],
    ['/org1/settings/tags', 'tags'],
    ['/org1/settings/rules', 'rules'],
    ['/org1/settings/banks', 'banks'],
    ['/org1/settings/subscription/extra', 'subscription'],
  ])('%s -> %s', (path, section) => {
    expect(activeSettingsSection(path, 'org1')).toBe(section)
  })

  it('matches an org id that needs encoding against the encoded pathname', () => {
    expect(activeSettingsSection('/org%201/settings/banks', 'org 1')).toBe('banks')
  })

  it.each(['/org1/settings', '/org1/settings/unknown', '/org2/settings/banks', '/org1/transactions', '/'])(
    '%s -> null',
    (path) => {
      expect(activeSettingsSection(path, 'org1')).toBeNull()
    },
  )
})

describe('settingsIndexRedirect', () => {
  it('sends a plain visit to Company', () => {
    expect(settingsIndexRedirect('org1', {})).toBe('/org1/settings/company')
  })

  it('keeps the query string', () => {
    expect(settingsIndexRedirect('org1', { tab: 'x', q: 'a b&c' })).toBe('/org1/settings/company?tab=x&q=a+b%26c')
  })

  it('keeps repeated keys and skips undefined values', () => {
    expect(settingsIndexRedirect('org1', { a: ['1', '2'], b: undefined })).toBe('/org1/settings/company?a=1&a=2')
  })

  it.each([
    [{ eb_connected: '1' }, '/org1/settings/banks?eb_connected=1'],
    [{ eb_error: '1' }, '/org1/settings/banks?eb_error=1'],
  ])('sends a bank return value to Banks: %o', (query, expected) => {
    expect(settingsIndexRedirect('org1', query)).toBe(expected)
  })

  it('no longer treats the retired eb_auth value as a bank return', () => {
    expect(settingsIndexRedirect('org1', { eb_auth: 'abc' })).toBe('/org1/settings/company?eb_auth=abc')
  })

  it('encodes the org id', () => {
    expect(settingsIndexRedirect('a/b', {})).toBe('/a%2Fb/settings/company')
  })
})

describe('role-aware settings sections', () => {
  const slugs = (role: Parameters<typeof visibleSettingsSections>[0]) => visibleSettingsSections(role).map((s) => s.slug)

  it('owner sees everything', () => {
    expect(slugs('owner')).toEqual(['company', 'language', 'categories', 'counterparties', 'tags', 'rules', 'banks', 'subscription'])
  })

  it('accountant and viewer do not see banks and subscription', () => {
    expect(slugs('accountant')).toEqual(['company', 'language', 'categories', 'counterparties', 'tags', 'rules'])
    expect(slugs('viewer')).toEqual(['company', 'language', 'categories', 'counterparties', 'tags', 'rules'])
  })

  it('without a role nothing opens', () => {
    expect(slugs(null)).toEqual([])
    expect(canOpenSection(null, 'company')).toBe(false)
  })

  it('canOpenSection matches the list', () => {
    expect(canOpenSection('owner', 'banks')).toBe(true)
    expect(canOpenSection('accountant', 'banks')).toBe(false)
    expect(canOpenSection('viewer', 'subscription')).toBe(false)
    expect(canOpenSection('viewer', 'categories')).toBe(true)
  })
})
