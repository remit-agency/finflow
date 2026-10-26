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
