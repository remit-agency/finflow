import { isId } from '@/lib/domain/ledger/guards'
import { parseTagPatch } from '@/lib/domain/tags/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { tags } from '@/lib/server/tags'
import { TAG_BODY_MAX_BYTES, toTagHttpError } from '@/lib/server/tags/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; tagId: string }> }

// PATCH /api/orgs/{orgId}/tags/{tagId}  (owner, accountant) { name?, color?, excludeFromAnalytics?, archived? }
// -> { tag, recalc }: with recalc the browser runs POST .../recalculate until done
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, tagId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(tagId)) throw new HttpError(404, 'not_found')
    const patch = parseTagPatch(await readJsonBody(req, TAG_BODY_MAX_BYTES))
    return Response.json(await tags.update(orgId, uid, tagId, patch), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toTagHttpError(e))
  }
}
