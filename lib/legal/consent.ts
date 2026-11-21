import { CONSENT_DOCS, LEGAL_VERSIONS, type ConsentDoc } from './versions'

export const CONSENT_SOURCES = ['register', 'google', 'gate'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

/** One accepted document. `at` is an ISO instant (a string in Firestore, never a Timestamp). */
export interface ConsentEntry { version: string; at: string; locale: string }
export type ConsentState = Partial<Record<ConsentDoc, ConsentEntry>>

export interface ConsentInput { docs: Record<ConsentDoc, string>; source: ConsentSource }
export type ConsentParse =
  | { ok: true; value: ConsentInput }
  | { ok: false; reason: 'invalid' | 'stale' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** True when the person has not accepted the CURRENT version of every document. `null` = no record. */
export function needsConsent(state: ConsentState | null): boolean {
  if (!state) return true
  return CONSENT_DOCS.some((doc) => state[doc]?.version !== LEGAL_VERSIONS[doc])
}

export type GateStatus = 'loading' | 'ok' | 'needed' | 'unknown'

/** `read` is what the browser got from userConsents/{uid}: undefined while loading, 'error' when the read failed. */
export function gateStatus(read: ConsentState | null | undefined | 'error'): GateStatus {
  if (read === undefined) return 'loading'
  if (read === 'error') return 'unknown'
  return needsConsent(read) ? 'needed' : 'ok'
}

/** Reads a stored `userConsents/{uid}` document; malformed entries are dropped (they then count as missing). */
export function parseConsentState(data: unknown): ConsentState {
  if (!isRecord(data)) return {}
  const out: ConsentState = {}
  for (const doc of CONSENT_DOCS) {
    const e = data[doc]
    if (isRecord(e) && typeof e.version === 'string' && typeof e.at === 'string' && typeof e.locale === 'string') {
      out[doc] = { version: e.version, at: e.at, locale: e.locale }
    }
  }
  return out
}

/** Parses the body of POST /api/consent. A version that is not the current one is `stale` (the bundle is old). */
export function parseConsentBody(body: unknown): ConsentParse {
  if (!isRecord(body) || !isRecord(body.docs)) return { ok: false, reason: 'invalid' }
  const source = body.source
  if (typeof source !== 'string' || !(CONSENT_SOURCES as readonly string[]).includes(source)) return { ok: false, reason: 'invalid' }
  const docs = {} as Record<ConsentDoc, string>
  for (const doc of CONSENT_DOCS) {
    const v = body.docs[doc]
    if (typeof v !== 'string') return { ok: false, reason: 'invalid' }
    docs[doc] = v
  }
  if (CONSENT_DOCS.some((doc) => docs[doc] !== LEGAL_VERSIONS[doc])) return { ok: false, reason: 'stale' }
  return { ok: true, value: { docs, source: source as ConsentSource } }
}
