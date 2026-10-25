// Maps errors thrown while signing in / signing up to catalog slugs (`errors.auth.<slug>` and
// `errors.orgCreate.<code>`). The pages translate the slug; this file stays free of next-intl.

import { OrgCreateError, type OrgCreateErrorCode } from './orgs-client'

export type AuthErrorKey =
  | 'wrongPassword'
  | 'userNotFound'
  | 'emailInUse'
  | 'weakPassword'
  | 'tooManyRequests'
  | 'network'
  | 'popupClosed'
  | 'generic'

const FIREBASE_CODES: Record<string, AuthErrorKey> = {
  'auth/wrong-password': 'wrongPassword',
  'auth/invalid-credential': 'wrongPassword',
  'auth/invalid-login-credentials': 'wrongPassword',
  'auth/user-not-found': 'userNotFound',
  'auth/email-already-in-use': 'emailInUse',
  'auth/weak-password': 'weakPassword',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
  'auth/popup-closed-by-user': 'popupClosed',
  'auth/cancelled-popup-request': 'popupClosed',
}

export function authErrorKey(err: unknown): AuthErrorKey {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string' && code in FIREBASE_CODES) return FIREBASE_CODES[code]
  }
  return 'generic'
}

export type AuthFailure =
  | { kind: 'orgCreate'; code: OrgCreateErrorCode }
  | { kind: 'auth'; key: AuthErrorKey }

/** Classifies any error from the sign-in / sign-up / company-creation flows. */
export function classifyAuthFailure(err: unknown): AuthFailure {
  if (err instanceof OrgCreateError) return { kind: 'orgCreate', code: err.code }
  return { kind: 'auth', key: authErrorKey(err) }
}
