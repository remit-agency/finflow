import { describe, expect, it } from 'vitest'
import { buildLocaleCookie } from '@/lib/i18n/client'

describe('buildLocaleCookie', () => {
  it.each(['pl', 'en', 'uk'] as const)('builds a one year cookie for %s', (locale) => {
    expect(buildLocaleCookie(locale)).toBe(`NEXT_LOCALE=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`)
  })

  it('adds Secure on https', () => {
    expect(buildLocaleCookie('pl', true)).toBe('NEXT_LOCALE=pl; Path=/; Max-Age=31536000; SameSite=Lax; Secure')
  })
})
