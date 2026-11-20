import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'
import { imports } from '@/lib/server/imports'
import { parseUndoRequest } from '@/lib/domain/import/request'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string; importId: string }> }
const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The undo body is optional: the client sends `{ cursor }` from the second page on, or `{}`. A request with no content type
 * carries no cursor and starts from the first page (safe: the undo is repeatable), so it is not a 415.
 */
async function undoBody(req: Request): Promise<unknown> {
  if (req.headers.get('content-type') === null) return undefined
  return readJsonBody(req, 1024)
}

// POST /api/orgs/{orgId}/imports/{importId}/undo  (owner, accountant)  { cursor? } -> UndoResult. Call until `done`.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, importId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!ID.test(importId)) throw new ImportError('invalid_input', 'importId')
    const parsed = parseUndoRequest(await undoBody(req))
    if (!parsed.ok) throw new ImportError('invalid_input', parsed.field)
    return Response.json(await imports.undoStep(orgId, uid, importId, parsed.value.cursor), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}
