import { parseDayQuery } from '@/lib/domain/forecast/query'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { forecast } from '@/lib/server/forecast'
import { enforceRateLimit, REPORT_LIMITS } from '@/lib/server/rate-limit-guard'
import { toReportHttpError } from '@/lib/server/reports/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/calendar/day?date=YYYY-MM-DD  (owner, accountant, viewer) -> DayPayments
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const date = parseDayQuery(new URL(req.url).searchParams)
    await enforceRateLimit(uid, 'reports', REPORT_LIMITS)
    return Response.json(await forecast.day(orgId, date), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toReportHttpError(e))
  }
}
