import { parseLinkRequest } from '@/lib/domain/banking/link-input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { bankDeps, banking } from '@/lib/server/banking'
import { toBankHttpError } from '@/lib/server/banking/errors'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/bank/accounts  (owner)
// { connectionId, ebAccountUid, mode: 'create'|'existing', accountId?, name?, importFrom } -> 201 { bankAccountId, accountId }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    const input = parseLinkRequest(await readJsonBody(req, 4 * 1024))
    return Response.json(await banking.linkAccount(bankDeps(req), orgId, uid, input), { status: 201 })
  } catch (e) {
    return errorResponse(toBankHttpError(e))
  }
}
