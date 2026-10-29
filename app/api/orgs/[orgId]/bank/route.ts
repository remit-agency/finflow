import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { bankDeps, banking } from '@/lib/server/banking'
import { toBankHttpError } from '@/lib/server/banking/errors'
import { errorResponse } from '@/lib/server/http-error'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/bank  (any member)
// -> { connections: [{ id, institutionName, status, validUntil, connectedAt }], accounts?: [...] }  (accounts: owner only)
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    const role = await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json(await banking.readStatus(bankDeps(req), orgId, role), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toBankHttpError(e))
  }
}
