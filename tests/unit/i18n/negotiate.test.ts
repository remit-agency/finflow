import { describe, expect, it } from 'vitest'
import { resolveLocale } from '@/lib/i18n/negotiate'

describe('resolveLocale', () => {
  it('a valid cookie wins over the browser language', () => {
    expect(resolveLocale({ cookie: 'uk', acceptLanguage: 'en-US,en;q=0.9' })).toBe('uk')
    expect(resolveLocale({ cookie: 'pl', acceptLanguage: 'uk' })).toBe('pl')
  })

  it.each([undefined, '', 'de', 'PL', 'uk-UA', 'xx', 'en '])('ignores the invalid cookie %j', (cookie) => {
    expect(resolveLocale({ cookie, acceptLanguage: 'en' })).toBe('en')
  })

  it.each([
    ['pl-PL,pl;q=0.9,en;q=0.8', 'pl'],
    ['en-US,en;q=0.9', 'en'],
    ['uk-UA,uk;q=0.9', 'uk'],
    ['ru-RU,ru;q=0.9,uk;q=0.8', 'uk'],
    ['de-DE,de;q=0.9,pl;q=0.5', 'pl'],
    ['en;q=0.5,pl;q=0.9', 'pl'],
    ['PL', 'pl'],
    ['en-gb', 'en'],
  ])('picks the best supported language from %j', (acceptLanguage, expected) => {
    expect(resolveLocale({ cookie: undefined, acceptLanguage })).toBe(expected)
  })

  it.each([null, undefined, '', '*', 'de-DE,fr;q=0.8', 'xx;q=abc', ';;;'])('falls back to Polish for %j', (acceptLanguage) => {
    expect(resolveLocale({ cookie: undefined, acceptLanguage })).toBe('pl')
  })

  it('ignores languages with q=0', () => {
    expect(resolveLocale({ cookie: undefined, acceptLanguage: 'en;q=0,uk;q=0.1' })).toBe('uk')
  })
})
