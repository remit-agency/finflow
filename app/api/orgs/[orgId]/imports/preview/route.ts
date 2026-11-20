import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'
import { imports } from '@/lib/server/imports'
import { parsePreviewRequest } from '@/lib/domain/import/request'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string }> }
/** The statement text (at most 4 MB) plus the JSON envelope. */
const MAX_BODY = 4 * 1024 * 1024 + 4096

// POST /api/orgs/{orgId}/imports/preview  (owner, accountant)  { fileName, text, accountIds? } -> PreviewResult.
// Writes nothing; safe to call again.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const parsed = parsePreviewRequest(await readJsonBody(req, MAX_BODY))
    if (!parsed.ok) throw new ImportError('invalid_input', parsed.field)
    return Response.json(await imports.previewImport(orgId, parsed.value), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}
