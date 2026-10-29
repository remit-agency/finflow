import { parsePreviewRequest } from '@/lib/domain/rules/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { rules } from '@/lib/server/rules'
import { toRuleHttpError } from '@/lib/server/rules/http'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BODY_BYTES = 32 * 1024
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/rules/preview  (owner, accountant)  { rule } -> { matched, scanned, capped }; nothing is written
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const { rule } = parsePreviewRequest(await readJsonBody(req, MAX_BODY_BYTES))
    return Response.json(await rules.preview(orgId, rule), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}
