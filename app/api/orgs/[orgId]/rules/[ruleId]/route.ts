import { isId } from '@/lib/domain/ledger/guards'
import { parseRulePatch } from '@/lib/domain/rules/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { rules } from '@/lib/server/rules'
import { toRuleHttpError } from '@/lib/server/rules/http'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 32 * 1024
type Ctx = { params: Promise<{ orgId: string; ruleId: string }> }

// PATCH /api/orgs/{orgId}/rules/{ruleId}  (owner, accountant) -> { rule }; also switches `active`
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, ruleId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(ruleId)) throw new HttpError(404, 'not_found')
    const patch = parseRulePatch(await readJsonBody(req, MAX_BODY_BYTES))
    const rule = await rules.update(orgId, uid, ruleId, patch)
    return Response.json({ rule }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/rules/{ruleId}  (owner, accountant) -> 204; the operations it already filled stay as they are
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, ruleId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(ruleId)) throw new HttpError(404, 'not_found')
    await rules.remove(orgId, uid, ruleId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}
