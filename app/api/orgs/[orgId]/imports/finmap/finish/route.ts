import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'
import { finmap } from '@/lib/server/imports/finmap'
import { parseFinmapFinish } from '@/lib/domain/import/finmap/request'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string }> }
const MAX_BODY = 1024

// POST /api/orgs/{orgId}/imports/finmap/finish  (owner, accountant)  { importId } -> { fitted, differences }. Fits each new account once.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const parsed = parseFinmapFinish(await readJsonBody(req, MAX_BODY))
    if (!parsed.ok) throw new ImportError('invalid_input', parsed.field)
    return Response.json(await finmap.finish(orgId, uid, parsed.value.importId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}
