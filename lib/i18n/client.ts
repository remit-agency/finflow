import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from './config'

/** The Set-Cookie style string for the language cookie (not HttpOnly: a preference, not a secret). */
export function buildLocaleCookie(locale: Locale, secure = false): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** Browser only: remembers the language. The caller refreshes the route (router.refresh()). */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = buildLocaleCookie(locale, window.location.protocol === 'https:')
}
