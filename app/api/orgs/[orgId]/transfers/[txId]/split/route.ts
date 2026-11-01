import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; txId: string }> }

// POST /api/orgs/{orgId}/transfers/{txId}/split  (owner, accountant) -> { restored }
// No body: the server reads the transfer itself and refuses with `conflict` if it changes before the write.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, txId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(txId)) throw new HttpError(404, 'not_found')
    const { restored } = await transfers.split(orgId, uid, txId)
    return Response.json({ restored }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
