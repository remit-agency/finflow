import { parseOrderRequest } from '@/lib/domain/rules/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { rules } from '@/lib/server/rules'
import { toRuleHttpError } from '@/lib/server/rules/http'

export const runtime = 'nodejs'

// 50 ids of at most 128 characters.
const MAX_BODY_BYTES = 16 * 1024
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/rules/order  (owner, accountant)  { ids: all the company's rule ids in the new order } -> 204
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const { ids } = parseOrderRequest(await readJsonBody(req, MAX_BODY_BYTES))
    await rules.order(orgId, uid, ids)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}
