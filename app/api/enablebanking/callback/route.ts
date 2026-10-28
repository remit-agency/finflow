import { createJwt } from '@/lib/enablebanking/jwt'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { bankDeps, banking } from '@/lib/server/banking'
import { verifyEbState } from '@/lib/server/eb-state'
import { errorResponse, HttpError } from '@/lib/server/http-error'

export const runtime = 'nodejs'

const BASE = 'https://api.enablebanking.com'

/** Strips control characters (log forging via CR/LF/ESC) and truncates untrusted query values for logging. */
function sanitizeForLog(value: string | null, max = 200): string {
  const clean = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function redirectTo(req: Request, path: string): Response {
  return new Response(null, { status: 307, headers: { Location: new URL(path, req.url).toString() } })
}

// GET /api/enablebanking/callback?code=xxx&state=xxx
// Enable Banking redirects the browser here after the bank login (a top-level navigation, so the
// SameSite=Lax session cookie is sent). Order matters: the HMAC-signed `state` created by
// /api/enablebanking/session is verified first (forgeries get 400 and nothing else is touched),
// then the session must belong to the same user as the state, then membership is checked.
// All of that happens BEFORE the code is exchanged.
// Bank connections are owner-only. On success the session is saved on the server (S09) and the
// redirect carries `?eb_connected=1` only. The session id does reach the members of the company, as the
// connection id in `GET /api/orgs/{orgId}/bank`: a non-secret handle; using it needs the app's private key.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const code = params.get('code')
  const state = params.get('state')

  let verified: { orgId: string; uid: string }
  try {
    if (!state) throw new HttpError(400, 'invalid state')
    verified = verifyEbState(state, process.env.EB_STATE_SECRET!)
  } catch (e) {
    return errorResponse(e)
  }
  const orgId = verified.orgId
  const settingsPath = `/${encodeURIComponent(orgId)}/settings/banks`

  try {
    const { uid } = await requireUser(req)
    if (uid !== verified.uid) throw new HttpError(403, 'forbidden')
    await requireOrgRole(verified.uid, verified.orgId, ['owner'])
  } catch (e) {
    // The session ended (or never existed) while the user was at the bank: sign in again and
    // come back to settings. The one-time code is dropped; the user restarts the connection.
    if (e instanceof HttpError && e.status === 401) {
      return redirectTo(req, `/login?redirect=${encodeURIComponent(settingsPath)}`)
    }
    return errorResponse(e)
  }

  // No code: the user cancelled at the bank or Enable Banking returned ?error=...
  if (!code) {
    console.error(
      'Enable Banking callback without code:',
      sanitizeForLog(params.get('error')),
      sanitizeForLog(params.get('error_description')),
    )
    return redirectTo(req, `${settingsPath}?eb_error=1`)
  }

  try {
    const token = await createJwt()
    const res = await fetch(`${BASE}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (!res.ok) {
      console.error('Enable Banking session error:', res.status, await res.text())
      return redirectTo(req, `${settingsPath}?eb_error=1`)
    }

    const data = await res.json()
    if (typeof data.session_id !== 'string') throw new Error('no session_id')
    // S09: the server reads the session (accounts, validUntil) and keeps it; the redirect does not carry the session id.
    const deps = bankDeps(req)
    const session = await deps.eb.getSession(data.session_id)
    await banking.saveSession(deps, orgId, verified.uid, session)
    return redirectTo(req, `${settingsPath}?eb_connected=1`)
  } catch (e) {
    console.error('Callback error:', e)
    return redirectTo(req, `${settingsPath}?eb_error=1`)
  }
}
