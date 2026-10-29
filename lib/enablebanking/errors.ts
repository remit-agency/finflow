/** Keys under `errors.bank` for a failed "connect this bank" request. */
export type ConnectErrorKey =
  | 'emailNotVerified'
  | 'connectForbidden'
  | 'connectInvalid'
  | 'connectUnavailable'
  | 'connectNetwork'
  | 'connect'

/**
 * Which message a failed bank-connect request shows. The raw server or browser text (an error
 * code, "Failed to fetch", an upstream body) is for the console only: it is English, not for
 * people, and may carry internals. `status` is null when no HTTP response arrived at all (offline,
 * DNS, a blocked request); `code` is the `error` field of a JSON response body, when there was one.
 */
export function connectErrorKey(status: number | null, code?: unknown): ConnectErrorKey {
  if (status === null) return 'connectNetwork'
  if (status === 403) return code === 'email_not_verified' ? 'emailNotVerified' : 'connectForbidden'
  if (status === 400) return 'connectInvalid'
  if (status === 429 || status === 502 || status === 503 || status === 504) return 'connectUnavailable'
  return 'connect'
}

/** Keys under `errors.bank` for a failed bank request (linking, sync, disconnect). */
export type BankErrorKey =
  | 'consentExpired'
  | 'rateLimited'
  | 'bankUnavailable'
  | 'currencyMismatch'
  | 'currencyUnsupported'
  | 'alreadyLinked'
  | 'syncFailed'
  | 'linkFailed'

/**
 * Which message a failed bank request shows, from the short code the server answered with (never the raw text).
 * Codes without a message of their own get `fallback` (sync failures by default, linking passes `linkFailed`).
 */
export function bankErrorKey(code: string, fallback: 'syncFailed' | 'linkFailed' = 'syncFailed'): BankErrorKey {
  switch (code) {
    case 'consent_expired':
      return 'consentExpired'
    case 'rate_limited':
      return 'rateLimited'
    case 'bank_unavailable':
    case 'bank_error':
      return 'bankUnavailable'
    case 'currency_mismatch':
      return 'currencyMismatch'
    case 'currency_unsupported':
      return 'currencyUnsupported'
    case 'already_linked':
      return 'alreadyLinked'
    default:
      return fallback
  }
}
