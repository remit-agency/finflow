import { isId } from '@/lib/domain/ledger/guards'
import { parseDeleteQuery, parseSeriesPatch } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; seriesId: string }> }

// GET /api/orgs/{orgId}/recurring/{seriesId}  (owner, accountant, viewer) -> { series }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const series = isId(seriesId) ? await recurring.get(orgId, seriesId) : null
    if (series === null) throw new HttpError(404, 'not_found')
    return Response.json({ series }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// PATCH /api/orgs/{orgId}/recurring/{seriesId}  (owner, accountant) { <fields>?, status?, removeFuture? }
// -> { series, created, updated, deleted }
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const patch = parseSeriesPatch(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    return Response.json(await recurring.update(orgId, uid, seriesId, patch), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/recurring/{seriesId}?future=delete|keep  (owner, accountant) -> { deleted }
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const mode = parseDeleteQuery(new URL(req.url).searchParams)
    return Response.json(await recurring.remove(orgId, uid, seriesId, mode), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
