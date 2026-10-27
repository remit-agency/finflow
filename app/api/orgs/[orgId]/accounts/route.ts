import { parseAccountInput } from '@/lib/domain/ledger/entity-input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 2048
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/accounts  (owner, accountant)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseAccountInput(await readJsonBody(req, MAX_BODY_BYTES))
    const account = await ledger.createAccount(orgId, uid, input)
    return Response.json({ account }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
