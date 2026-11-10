import { parseMatchRequest } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/recurring/matches  (owner, accountant)
// { confirm: [{ planId, bankId, versions: [plan, bank] }] } | { undo: [planId] }
// -> { results: [{ planId, ok: true, bankId } | { planId, ok: false, code }] }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const request = parseMatchRequest(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    const results = await recurring.matches(orgId, uid, request)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
