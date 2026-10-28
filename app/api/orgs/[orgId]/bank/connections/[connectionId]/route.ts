import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { bankDeps, banking } from '@/lib/server/banking'
import { toBankHttpError } from '@/lib/server/banking/errors'
import { errorResponse, HttpError } from '@/lib/server/http-error'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ orgId: string; connectionId: string }> }
const ID = /^[A-Za-z0-9_-]{1,128}$/

// GET /api/orgs/{orgId}/bank/connections/{connectionId}  (owner) -> { accounts: [{ uid, iban, currency, name, linked }] }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, connectionId } = await params
    if (!ID.test(connectionId)) throw new HttpError(400, 'invalid_input')
    await requireOrgRole(uid, orgId, ['owner'])
    return Response.json(await banking.listConnectionAccounts(bankDeps(req), orgId, connectionId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toBankHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/bank/connections/{connectionId}  (owner) -> 204
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, connectionId } = await params
    if (!ID.test(connectionId)) throw new HttpError(400, 'invalid_input')
    await requireOrgRole(uid, orgId, ['owner'])
    await banking.disconnect(bankDeps(req), orgId, connectionId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(toBankHttpError(e))
  }
}
