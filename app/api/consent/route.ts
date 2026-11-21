import { requireUser } from '@/lib/server/auth'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError, errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { recordConsent } from '@/lib/server/consent'
import { CONSENT_LIMITS, enforceRateLimit } from '@/lib/server/rate-limit-guard'
import { readLocaleCookie } from '@/lib/server/session-cookie'
import { parseConsentBody } from '@/lib/legal/consent'
import { resolveLocale } from '@/lib/i18n/negotiate'

export const runtime = 'nodejs'
const MAX_BODY = 512

// POST /api/consent  { docs: { terms, privacy }, source }  ->  { state }
// Any signed-in user (a verified email is NOT required: the person accepts before verifying). 409 `stale_version`
// when the browser still has an older bundle (the person reloads), 400 `invalid_input` for a bad body.
export async function POST(req: Request) {
  try {
    const { uid } = await requireUser(req)
    await enforceRateLimit(uid, 'consent', CONSENT_LIMITS)
    const parsed = parseConsentBody(await readJsonBody(req, MAX_BODY))
    if (!parsed.ok) throw new HttpError(parsed.reason === 'stale' ? 409 : 400, parsed.reason === 'stale' ? 'stale_version' : 'invalid_input')
    const locale = resolveLocale({ cookie: readLocaleCookie(req.headers), acceptLanguage: req.headers.get('accept-language') })
    const state = await recordConsent(getAdmin().db, uid, parsed.value, locale, new Date())
    return Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
