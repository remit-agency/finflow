import { createJwt } from '@/lib/enablebanking/jwt'
import { requireOrgRole, requireVerifiedUser } from '@/lib/server/auth'
import { signEbState } from '@/lib/server/eb-state'
import { errorResponse, HttpError } from '@/lib/server/http-error'

export const runtime = 'nodejs'

const BASE = 'https://api.enablebanking.com'
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const COUNTRY_RE = /^[A-Z]{2}$/

// POST /api/enablebanking/session  { aspspName, aspspCountry?, orgId }
// Requires the session cookie of a user with a verified email who is a member of `orgId`.
// Bank connections are owner-only.
export async function POST(req: Request) {
  try {
    const { uid } = await requireVerifiedUser(req)

    const body: unknown = await req.json().catch(() => null)
    const { aspspName, aspspCountry = 'PL', orgId, psuType = 'business' } = (body ?? {}) as Record<string, unknown>
    if (typeof aspspName !== 'string' || aspspName.length === 0 || aspspName.length > 200) {
      throw new HttpError(400, 'Missing params')
    }
    if (typeof orgId !== 'string' || !ID_RE.test(orgId)) throw new HttpError(400, 'Missing params')
    // The kind of customer the access is granted for (S09): business by default, personal when the owner chose it.
    if (psuType !== 'business' && psuType !== 'personal') throw new HttpError(400, 'Missing params')
    if (typeof aspspCountry !== 'string' || !COUNTRY_RE.test(aspspCountry)) {
      throw new HttpError(400, 'invalid country')
    }

    await requireOrgRole(uid, orgId, ['owner'])

    // In production the redirect URL must come from config, never from the (spoofable) request origin.
    const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!configuredUrl && process.env.NODE_ENV === 'production') {
      throw new HttpError(500, 'server not configured')
    }
    const appUrl = configuredUrl || new URL(req.url).origin

    const state = signEbState({ orgId, uid }, process.env.EB_STATE_SECRET!)
    const token = await createJwt()

    const res = await fetch(`${BASE}/auth`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access: {
          valid_until: new Date(Date.now() + 90 * 86400_000).toISOString(),
          balances: true,
          transactions: true,
        },
        aspsp: { name: aspspName, country: aspspCountry },
        redirect_url: `${appUrl}/api/enablebanking/callback`,
        psu_type: psuType,
        state,
      }),
    })

    if (!res.ok) {
      console.error('Enable Banking POST /auth failed:', res.status, await res.text())
      throw new HttpError(502, 'enable banking error')
    }
    const data = await res.json()
    return Response.json({ url: data.url, authorizationId: data.authorization_id })
  } catch (e) {
    return errorResponse(e)
  }
}
