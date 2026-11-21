// Versions of the documents a person must accept. Pure: shared by the server and the browser.
// A change to the text that touches rights or duties means a NEW version here (and the gate asks again).
export const CONSENT_DOCS = ['terms', 'privacy'] as const
export type ConsentDoc = (typeof CONSENT_DOCS)[number]

/** Every public legal page. `cookies` is information, not a consent, so it has no version. */
export const PUBLIC_LEGAL_DOCS = ['terms', 'privacy', 'cookies'] as const
export type PublicLegalDoc = (typeof PUBLIC_LEGAL_DOCS)[number]

export const LEGAL_VERSIONS: Readonly<Record<ConsentDoc, string>> = {
  terms: '2026-11-21',
  privacy: '2026-11-21',
}

export function isPublicLegalDoc(value: unknown): value is PublicLegalDoc {
  return typeof value === 'string' && (PUBLIC_LEGAL_DOCS as readonly string[]).includes(value)
}
