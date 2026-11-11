import 'server-only'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError } from '@/lib/server/http-error'
import { consumeRateLimit, type RateWindow } from './rate-limit'

/** White list lookups: they call a public government API, so they are the narrowest. */
export const LOOKUP_LIMITS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 30 },
  { name: 'h', seconds: 3600, max: 300 },
]

/** NBP rates: the answers are cached for minutes, so a user never needs many. */
export const RATES_LIMITS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 120 },
  { name: 'h', seconds: 3600, max: 1200 },
]

/**
 * The reports (S12) of one user, across the companies and the five report routes: a page asks once per change, and a filter
 * or a period change asks again; each ask reads up to REPORT_SCAN_CAP documents and may fetch NBP tables.
 */
export const REPORT_LIMITS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 60 },
  { name: 'h', seconds: 3600, max: 1200 },
]

/** Throws `HttpError(429, 'rate_limited')` when the user is over a limit of the scope. */
export async function enforceRateLimit(uid: string, scope: 'lookup' | 'rates' | 'reports', limits: readonly RateWindow[], now: Date = new Date()): Promise<void> {
  const safeUid = uid.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!(await consumeRateLimit(getAdmin().db, `${scope}_${safeUid}`, limits, now))) throw new HttpError(429, 'rate_limited')
}
