import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'
import { finmap } from '@/lib/server/imports/finmap'
import { parseFinmapSetup } from '@/lib/domain/import/finmap/request'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string }> }
/** The names of a whole file (up to 5 000 categories and counterparties) plus the JSON envelope. */
const MAX_BODY = 2 * 1024 * 1024

// POST /api/orgs/{orgId}/imports/finmap/setup  (owner, accountant)  { fileName, accounts, categories, counterparties, tags, importId? }
// -> the import id and the ids of every name. Creates only what does not exist (matched by name), so a repeat creates nothing.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const parsed = parseFinmapSetup(await readJsonBody(req, MAX_BODY))
    if (!parsed.ok) throw new ImportError('invalid_input', parsed.field)
    return Response.json(await finmap.setup(orgId, uid, parsed.value), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toImportHttpError(e))
  }
}
