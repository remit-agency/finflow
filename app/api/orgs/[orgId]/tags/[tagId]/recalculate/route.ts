import { isId } from '@/lib/domain/ledger/guards'
import { parseRecalcRequest } from '@/lib/domain/tags/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { tags } from '@/lib/server/tags'
import { toTagHttpError } from '@/lib/server/tags/http'

export const runtime = 'nodejs'
// A step is up to 100 Firestore transactions, one per operation.
export const maxDuration = 60

const MAX_BODY_BYTES = 1024
type Ctx = { params: Promise<{ orgId: string; tagId: string }> }

// POST /api/orgs/{orgId}/tags/{tagId}/recalculate  (owner, accountant) { cursor? }
// One step -> { scanned, changed, done, cursor }. Call again with the cursor while done is false; repeating is safe.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, tagId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(tagId)) throw new HttpError(404, 'not_found')
    const { cursor } = parseRecalcRequest(await readJsonBody(req, MAX_BODY_BYTES))
    return Response.json(await tags.recalculate(orgId, uid, tagId, cursor), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toTagHttpError(e))
  }
}
