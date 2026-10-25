// Locale configuration (S03). No imports: used by the server, the browser and tests.

export const LOCALES = ['pl', 'en', 'uk'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'pl'
export const LOCALE_COOKIE = 'NEXT_LOCALE'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** BCP 47 tag handed to Intl for each UI language. */
export const INTL_LOCALE: Record<Locale, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
  uk: 'uk-UA',
}

/** Always written in the language itself, so a user can find it whatever the UI language is. */
export const LOCALE_LABELS: Record<Locale, string> = {
  pl: 'Polski',
  en: 'English',
  uk: 'Українська',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
