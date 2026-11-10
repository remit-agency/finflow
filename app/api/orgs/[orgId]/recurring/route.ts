import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/recurring  (owner, accountant, viewer) -> { series, overdueCount, overdue, upcoming, soon, truncated }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json(await recurring.overview(orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// POST /api/orgs/{orgId}/recurring  (owner, accountant) <series body> -> 201 { series, created }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseSeriesInput(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    return Response.json(await recurring.create(orgId, uid, input), { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
