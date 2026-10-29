import { parseApplyRequest } from '@/lib/domain/rules/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { rules } from '@/lib/server/rules'
import { toRuleHttpError } from '@/lib/server/rules/http'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BODY_BYTES = 2 * 1024
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/rules/apply  (owner, accountant)  { mode: 'check' | 'apply', cursor? }
// One step: check -> { scanned, matchOps, categories, counterparties, done, cursor } (nothing is written);
// apply -> { scanned, changed, failed, done, cursor }. Call again with the cursor while done is false.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const { mode, cursor } = parseApplyRequest(await readJsonBody(req, MAX_BODY_BYTES))
    const result = mode === 'check' ? await rules.check(orgId, cursor) : await rules.apply(orgId, uid, cursor)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRuleHttpError(e))
  }
}
