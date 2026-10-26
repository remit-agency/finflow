// Client-side guard for the `?eb_auth=` return value of the Enable Banking callback.
// Pure (storage is injected), so it is unit-testable and safe in the browser bundle.
//
// The callback hands the new bank session id back in the URL. Without this guard, anyone could
// send a signed-in user a link `/<org>/settings/banks?eb_auth=...` and make their browser save a
// foreign bank session into that org. A connection is only accepted when this tab started one
// (handleConnect writes `eb_pending` to sessionStorage right before leaving for the bank).
// The proper fix, a server-side write bound to the signed state, is planned for S09.

export const EB_PENDING_KEY = 'eb_pending'
const MAX_SESSION_ID_LENGTH = 200
// Used only when the pending entry has no name; callers pass the translated word for "Bank".
const DEFAULT_INSTITUTION_NAME = 'Bank'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** base64url (padded or not) -> UTF-8 JSON value; undefined when it does not decode. */
function decodePayload(payload: string): unknown {
  try {
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return undefined
  }
}

/**
 * Returns the connection to save, or null to ignore the payload. Accepts only when this tab has a
 * pending connection AND the payload is base64url JSON with a non-empty string `sessionId` of at
 * most 200 characters. Accepting consumes the pending entry (one-shot); a rejected payload leaves
 * it in place, so a junk link cannot cancel the user's own connection that is still in flight.
 */
export function acceptEbAuth(
  payload: string | null,
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  fallbackName: string = DEFAULT_INSTITUTION_NAME,
): { sessionId: string; institutionName: string } | null {
  if (!payload) return null

  const rawPending = storage.getItem(EB_PENDING_KEY)
  if (rawPending === null) return null
  const pending = parseJson(rawPending)
  if (!isPlainObject(pending)) return null

  const decoded = decodePayload(payload)
  if (!isPlainObject(decoded)) return null
  const { sessionId } = decoded
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return null
  }

  storage.removeItem(EB_PENDING_KEY)
  const name = pending.name
  return {
    sessionId,
    institutionName: typeof name === 'string' && name.length > 0 ? name : fallbackName,
  }
}
