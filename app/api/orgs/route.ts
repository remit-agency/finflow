import { requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { createOrganizationForUser, parseCreateOrgInput } from '@/lib/server/orgs'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

// A legitimate body is `{"name":"<=120 chars","currency":"PLN"}`.
const MAX_BODY_BYTES = 2048

// POST /api/orgs  { name, currency }
// The only way to create a company: the browser never writes organizations or memberships
// (firestore.rules). Requires a session (and a same-origin request); a verified email is not required.
export async function POST(req: Request) {
  try {
    const { uid } = await requireUser(req)

    const body = await readJsonBody(req, MAX_BODY_BYTES)

    const orgId = await createOrganizationForUser(uid, parseCreateOrgInput(body))
    return Response.json({ orgId }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
