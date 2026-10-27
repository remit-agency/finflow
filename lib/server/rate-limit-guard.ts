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

/** Throws `HttpError(429, 'rate_limited')` when the user is over a limit of the scope. */
export async function enforceRateLimit(uid: string, scope: 'lookup' | 'rates', limits: readonly RateWindow[], now: Date = new Date()): Promise<void> {
  const safeUid = uid.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!(await consumeRateLimit(getAdmin().db, `${scope}_${safeUid}`, limits, now))) throw new HttpError(429, 'rate_limited')
}
