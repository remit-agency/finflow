import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { ledger } from '@/lib/server/ledger'
import { toHttpError } from '@/lib/server/ledger/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

/** The only accepted query is a single `apply=0|1`; absent means a dry run. */
function parseApply(url: string): boolean {
  const query = new URL(url).searchParams
  const keys = [...query.keys()]
  if (keys.length === 0) return false
  if (keys.length !== 1 || keys[0] !== 'apply') throw new HttpError(400, 'invalid_params')
  const value = query.get('apply')
  if (value !== '0' && value !== '1') throw new HttpError(400, 'invalid_params')
  return value === '1'
}

// POST /api/orgs/{orgId}/ledger/rebuild[?apply=0|1]  (owner only; no body)
// Dry run by default: reports the differences between stored and recomputed balances and rollups.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    const apply = parseApply(req.url)
    const report = await ledger.rebuild(orgId, uid, apply)
    return Response.json({ report }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
