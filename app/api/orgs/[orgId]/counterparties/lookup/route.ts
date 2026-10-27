import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { normalizeNip } from '@/lib/domain/counterparties/normalize'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse } from '@/lib/server/http-error'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/counterparties/lookup?nip=7740001454  (owner, accountant)
// What the MF white list knows about a NIP, for filling the counterparty form. Saves nothing.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])

    const query = new URL(req.url).searchParams
    const keys = [...query.keys()]
    if (keys.length !== 1 || keys[0] !== 'nip' || query.getAll('nip').length !== 1) {
      throw new CounterpartyError('invalid_input', { field: 'nip' })
    }
    const nip = normalizeNip(query.get('nip'))

    const answer = await counterparties.lookup(uid, nip)
    return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
