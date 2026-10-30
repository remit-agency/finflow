import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { tags } from '@/lib/server/tags'
import { toTagHttpError } from '@/lib/server/tags/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; tagId: string }> }

// GET /api/orgs/{orgId}/tags/{tagId}/impact  (owner, accountant) -> { operations }: what a change of the flag recalculates
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, tagId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(tagId)) throw new HttpError(404, 'not_found')
    return Response.json({ operations: await tags.impact(orgId, tagId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toTagHttpError(e))
  }
}
