import { parseReportQuery } from '@/lib/domain/reports/query'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { enforceRateLimit, REPORT_LIMITS } from '@/lib/server/rate-limit-guard'
import { reports } from '@/lib/server/reports'
import { toReportHttpError } from '@/lib/server/reports/http'

export const runtime = 'nodejs'
// A filtered P&L counts, then reads up to REPORT_SCAN_CAP operations: seconds, inside one minute.
export const maxDuration = 60

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/reports/pl?from=&to=&types=&cat=&cp=&tg=&accounts=  (owner, accountant, viewer) -> PLReport
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const query = parseReportQuery(new URL(req.url).searchParams)
    await enforceRateLimit(uid, 'reports', REPORT_LIMITS)
    return Response.json(await reports.pl(orgId, query), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toReportHttpError(e))
  }
}
