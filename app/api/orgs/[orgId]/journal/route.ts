import { parseFilters } from '@/lib/domain/journal/filter'
import { decodeCursor, parseLimit } from '@/lib/domain/journal/order'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { journal } from '@/lib/server/journal'
import { toHttpError } from '@/lib/server/ledger/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/journal?<filters>&cursor=&limit=  (owner, accountant, viewer)
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const { searchParams } = new URL(req.url)
    const raw = searchParams.get('cursor')
    const cursor = raw ? decodeCursor(raw) : null
    if (raw && !cursor) throw new HttpError(400, 'invalid_input')
    const page = await journal.readPage(orgId, { filters: parseFilters(searchParams), cursor, limit: parseLimit(searchParams.get('limit')) })
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
