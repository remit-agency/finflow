import { parseTransferRequest } from '@/lib/domain/transfers/input'
import { TRANSFER_BODY_MAX_BYTES } from '@/lib/domain/transfers/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/transfers  (owner, accountant)
// { pairs: [{ fromId, toId, versions: [from, to] }] } | { merge: [a, b] } | { convert: { ids, toAccountId } }
// -> { results: [{ ids, ok: true, id, deletedId, droppedTags, before } | { ids, ok: false, code }] }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const request = parseTransferRequest(await readJsonBody(req, TRANSFER_BODY_MAX_BYTES))
    const results = await transfers.run(orgId, uid, request)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
