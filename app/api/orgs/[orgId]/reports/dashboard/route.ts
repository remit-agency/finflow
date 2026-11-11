import { assertNoParams } from '@/lib/domain/reports/query'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { enforceRateLimit, REPORT_LIMITS } from '@/lib/server/rate-limit-guard'
import { reports } from '@/lib/server/reports'
import { toReportHttpError } from '@/lib/server/reports/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/reports/dashboard  (owner, accountant, viewer) -> DashboardReport («Гроші зараз»; never cached)
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    assertNoParams(new URL(req.url).searchParams)
    await enforceRateLimit(uid, 'reports', REPORT_LIMITS)
    return Response.json(await reports.dashboard(orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toReportHttpError(e))
  }
}
