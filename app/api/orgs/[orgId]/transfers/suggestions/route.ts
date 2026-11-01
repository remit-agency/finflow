import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/transfers/suggestions  (owner, accountant, viewer) -> { pairs, total, ambiguous, truncated }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const result = await transfers.suggestions(orgId)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
