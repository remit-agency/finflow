import { requireUser, toAuthHttpError } from '@/lib/server/auth'
import { getAdmin } from '@/lib/server/firebase-admin'
import { errorResponse } from '@/lib/server/http-error'
import { listMemberships } from '@/lib/server/orgs'
import { parseConsentState } from '@/lib/legal/consent'

export const runtime = 'nodejs'

// GET /api/me/export  (signed-in user)  ->  { uid, email, displayName, createdAt, memberships: [{ orgId, role }], consents }
// The person's own account data. `consents` is the state document of userConsents/{uid}, null when there is none.
export async function GET(req: Request) {
  try {
    const { uid } = await requireUser(req)
    const { auth, db } = getAdmin()
    let user
    try {
      user = await auth.getUser(uid)
    } catch (e) {
      throw toAuthHttpError(e, 'getUser')
    }
    const [memberships, consent] = await Promise.all([listMemberships(db, uid), db.doc(`userConsents/${uid}`).get()])
    const created = user.metadata.creationTime
    const createdMs = Date.parse(created)
    return Response.json(
      {
        uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        createdAt: Number.isNaN(createdMs) ? created : new Date(createdMs).toISOString(),
        memberships,
        consents: consent.exists ? parseConsentState(consent.data()) : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return errorResponse(e)
  }
}
