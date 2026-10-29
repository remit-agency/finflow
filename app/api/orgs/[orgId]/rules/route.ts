import { parseRuleInput } from '@/lib/domain/rules/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { rules } from '@/lib/server/rules'
import { RULE_BODY_MAX_BYTES, toRuleHttpError } from '@/lib/server/rules/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/rules  (owner, accountant, viewer) -> { rules } in the order they apply, each with `unusable`
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json({ rules: await rules.list(orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}

// POST /api/orgs/{orgId}/rules  (owner, accountant) -> 201 { rule }; the new rule goes to the end of the order
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseRuleInput(await readJsonBody(req, RULE_BODY_MAX_BYTES))
    const rule = await rules.create(orgId, uid, input)
    return Response.json({ rule }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}
