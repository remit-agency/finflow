import 'server-only'

/** Name kept from the pre-S01 cookie; it now carries a Firebase session cookie (a signed JWT). */
export const SESSION_COOKIE_NAME = '__session'
/** Absolute session lifetime: 7 days (no sliding renewal). */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

/** Only production is served over HTTPS; `Secure` cookies would not be stored on plain-http dev. */
export function isSecureCookieEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** The value of a cookie in a request's Cookie header, or null when it is missing or empty. */
export function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    const value = part.slice(eq + 1).trim()
    return value.length > 0 ? value : null
  }
  return null
}

/** Extracts the `__session` value from a request's Cookie header, or null. */
export function readSessionCookie(headers: Headers): string | null {
  return readCookie(headers, SESSION_COOKIE_NAME)
}

function attributes(maxAgeSeconds: number, secure: boolean): string {
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** `Set-Cookie` header value that stores a freshly minted session cookie. */
export function buildSessionCookie(value: string, secure: boolean = isSecureCookieEnv()): string {
  return `${SESSION_COOKIE_NAME}=${value}; ${attributes(SESSION_MAX_AGE_SECONDS, secure)}`
}

/** `Set-Cookie` header value that deletes the session cookie (same attributes, Max-Age=0). */
export function buildClearedSessionCookie(secure: boolean = isSecureCookieEnv()): string {
  return `${SESSION_COOKIE_NAME}=; ${attributes(0, secure)}`
}
