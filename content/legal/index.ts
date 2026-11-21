import { OUTLINE } from './outline'
import { OPERATOR_TOKENS, type LegalContent } from '@/lib/legal/content-types'
import type { Operator } from '@/content/legal/operator'
import type { PublicLegalDoc } from '@/lib/legal/versions'
import type { Locale } from '@/lib/i18n/config'
import { cookiesPl } from './cookies.pl'
import { cookiesEn } from './cookies.en'
import { cookiesUk } from './cookies.uk'
import { privacyPl } from './privacy.pl'
import { privacyEn } from './privacy.en'
import { privacyUk } from './privacy.uk'
// terms is imported in Task 8

const CONTENT: Partial<Record<PublicLegalDoc, Record<Locale, LegalContent>>> = {
  privacy: { pl: privacyPl, en: privacyEn, uk: privacyUk },
  cookies: { pl: cookiesPl, en: cookiesEn, uk: cookiesUk },
}

export function getLegalContent(doc: PublicLegalDoc, locale: Locale): LegalContent {
  const byLocale = CONTENT[doc]
  if (!byLocale) throw new Error(`no legal content for ${doc}`)
  return byLocale[locale]
}

const TOKEN_KEYS: readonly string[] = OPERATOR_TOKENS

/** Fills the operator tokens; an empty field shows as `[…]` so a draft page never shows a raw token. Other `{x}` stay as written. */
export function fillOperator(text: string, operator: Operator): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!TOKEN_KEYS.includes(key)) return whole
    return String((operator as unknown as Record<string, unknown>)[key] ?? '') || '[…]'
  })
}

export { OUTLINE }
