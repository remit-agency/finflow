import { parseTagInput } from '@/lib/domain/tags/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { tags } from '@/lib/server/tags'
import { TAG_BODY_MAX_BYTES, toTagHttpError } from '@/lib/server/tags/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/tags  (owner, accountant, viewer) -> { tags } by name, the archived ones too
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json({ tags: await tags.list(orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toTagHttpError(e))
  }
}

// POST /api/orgs/{orgId}/tags  (owner, accountant) { name, color?, excludeFromAnalytics? } -> 201 { tag }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseTagInput(await readJsonBody(req, TAG_BODY_MAX_BYTES))
    const tag = await tags.create(orgId, uid, input)
    return Response.json({ tag }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toTagHttpError(e))
  }
}
