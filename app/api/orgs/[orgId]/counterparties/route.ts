import { parseCounterpartyInput } from '@/lib/domain/counterparties/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4096
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/counterparties  (owner, accountant)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseCounterpartyInput(await readJsonBody(req, MAX_BODY_BYTES))
    const counterparty = await counterparties.create(orgId, uid, input)
    return Response.json({ counterparty }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
