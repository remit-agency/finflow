import { parseBulkRequest } from '@/lib/domain/journal/bulk-input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { journal } from '@/lib/server/journal'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 8 * 1024
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/transactions/bulk  (owner, accountant)
// { action: 'update', ids: [...≤25], patch: {...} } | { action: 'delete', ids: [...≤25] }
// -> { results: [{ id, ok: true } | { id, ok: false, code }] }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const request = parseBulkRequest(await readJsonBody(req, MAX_BODY_BYTES))
    const results = await journal.bulk(orgId, uid, request)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
