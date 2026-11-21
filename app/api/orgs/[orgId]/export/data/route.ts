import { requireOrgRole, requireVerifiedUser } from '@/lib/server/auth'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError, errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { EXPORT_LIMITS, enforceRateLimit } from '@/lib/server/rate-limit-guard'
import { auditCol } from '@/lib/server/ledger/paths'
import { auditData } from '@/lib/server/ledger/audit'
import { readExportPage } from '@/lib/server/export/read'
import { isExportCollection, parseExportCounts } from '@/lib/domain/export/collections'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ orgId: string }> }
const MAX_BODY = 2048
const MAX_AFTER = 200

// GET /api/orgs/{orgId}/export/data?collection=&after=  (owner, verified email)  ->  { docs: [{ id, data }], next }
// One page of one collection of the company (see lib/server/export/read.ts); `next` is the `after` of the following call, null at the end.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireVerifiedUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    await enforceRateLimit(uid, 'export', EXPORT_LIMITS)
    const query = new URL(req.url).searchParams
    const collection = query.get('collection')
    const after = query.get('after')
    if (!isExportCollection(collection)) throw new HttpError(400, 'invalid_input')
    if (after !== null && after.length > MAX_AFTER) throw new HttpError(400, 'invalid_input')
    return Response.json(await readExportPage(getAdmin().db, orgId, collection, after), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}

// POST /api/orgs/{orgId}/export/data  { counts: { <collection>: n } }  (owner, verified email)  ->  { ok: true }
// The browser calls it once when an export has finished: ONE audit entry `data.export` with the counts, never the content.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireVerifiedUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    await enforceRateLimit(uid, 'export', EXPORT_LIMITS)
    const counts = parseExportCounts(await readJsonBody(req, MAX_BODY))
    if (!counts) throw new HttpError(400, 'invalid_input')
    const db = getAdmin().db
    await auditCol(db, orgId).doc().create(auditData({ now: () => new Date() }, 'data.export', uid, orgId, null, { counts }))
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
