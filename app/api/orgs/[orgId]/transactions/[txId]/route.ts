import { isId } from '@/lib/domain/ledger/guards'
import { parseTransactionPatch } from '@/lib/domain/ledger/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024
type Ctx = { params: Promise<{ orgId: string; txId: string }> }

// PATCH /api/orgs/{orgId}/transactions/{txId}  (owner, accountant)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, txId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(txId)) throw new HttpError(404, 'not_found')
    const patch = parseTransactionPatch(await readJsonBody(req, MAX_BODY_BYTES))
    const { transaction } = await ledger.updateTransaction(orgId, uid, txId, patch)
    return Response.json({ transaction }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/transactions/{txId}  (owner, accountant)
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, txId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(txId)) throw new HttpError(404, 'not_found')
    await ledger.deleteTransaction(orgId, uid, txId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
