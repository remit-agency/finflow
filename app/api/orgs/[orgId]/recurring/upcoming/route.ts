import { parseUpcomingQuery } from '@/lib/domain/recurring/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/recurring/upcoming?period=month|half|all  (owner, accountant, viewer)
//   -> { period, overdueCount, overdue, upcomingCount, upcoming, names }   (period absent: month)
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const period = parseUpcomingQuery(new URL(req.url).searchParams)
    return Response.json(await recurring.upcoming(orgId, period), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
