import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'
import { imports } from '@/lib/server/imports'
import { parseImportStep } from '@/lib/domain/import/request'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/imports  (owner, accountant)  -> { imports: ImportView[] }, newest first.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    return Response.json({ imports: await imports.listImports(orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}

// POST /api/orgs/{orgId}/imports  (owner, accountant)  one write step of a statement (at most 25 operations) -> ImportStepResult.
// Call again with the returned importId and the next chunk; `last: true` on the final step of the statement.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const parsed = parseImportStep(await readJsonBody(req, 64 * 1024))
    if (!parsed.ok) throw new ImportError('invalid_input', parsed.field)
    return Response.json(await imports.importStep(orgId, uid, parsed.value), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}
