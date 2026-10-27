import { parseCounterpartyPatch } from '@/lib/domain/counterparties/input'
import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4096
type Ctx = { params: Promise<{ orgId: string; counterpartyId: string }> }

// PATCH /api/orgs/{orgId}/counterparties/{counterpartyId}  (owner, accountant)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, counterpartyId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(counterpartyId)) throw new HttpError(404, 'not_found')
    const patch = parseCounterpartyPatch(await readJsonBody(req, MAX_BODY_BYTES))
    const counterparty = await counterparties.update(orgId, uid, counterpartyId, patch)
    return Response.json({ counterparty }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
