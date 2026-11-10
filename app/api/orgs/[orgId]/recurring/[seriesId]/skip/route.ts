import { isId } from '@/lib/domain/ledger/guards'
import { parseSkipBody } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; seriesId: string }> }

// POST /api/orgs/{orgId}/recurring/{seriesId}/skip  (owner, accountant) { occurrence } -> { before }: the plan as it was (for the undo)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const { occurrence } = parseSkipBody(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    const before = await recurring.skip(orgId, uid, seriesId, occurrence)
    return Response.json({ before }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
