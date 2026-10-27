import { parseOrgPatch } from '@/lib/domain/ledger/entity-input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 1024
type Ctx = { params: Promise<{ orgId: string }> }

// PATCH /api/orgs/{orgId}  { name?, currency? }  (owner only)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    const patch = parseOrgPatch(await readJsonBody(req, MAX_BODY_BYTES))
    const organization = await ledger.updateOrganization(orgId, uid, patch)
    return Response.json({ organization }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
