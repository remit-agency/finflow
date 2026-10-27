import { parseAccountPatch } from '@/lib/domain/ledger/entity-input'
import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 2048
type Ctx = { params: Promise<{ orgId: string; accountId: string }> }

// PATCH /api/orgs/{orgId}/accounts/{accountId}  (owner, accountant)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, accountId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(accountId)) throw new HttpError(404, 'not_found')
    const patch = parseAccountPatch(await readJsonBody(req, MAX_BODY_BYTES))
    const account = await ledger.updateAccount(orgId, uid, accountId, patch)
    return Response.json({ account }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/accounts/{accountId}  (owner, accountant)
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, accountId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(accountId)) throw new HttpError(404, 'not_found')
    await ledger.deleteAccount(orgId, uid, accountId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
