import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { bankDeps, banking } from '@/lib/server/banking'
import { BankError, toBankHttpError } from '@/lib/server/banking/errors'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'
export const maxDuration = 60
type Ctx = { params: Promise<{ orgId: string }> }
const ID = /^[A-Za-z0-9_-]{1,128}$/

// POST /api/orgs/{orgId}/bank/sync  (owner)  { bankAccountId }
// One step of a sync -> { imported, skipped, failed, done, bankBalanceMinor, differenceMinor }; call again while done is false.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner'])
    const body = (await readJsonBody(req, 1024)) as { bankAccountId?: unknown } | null
    if (typeof body?.bankAccountId !== 'string' || !ID.test(body.bankAccountId)) throw new BankError('invalid_input')
    const result = await banking.syncStep(bankDeps(req), orgId, uid, body.bankAccountId)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toBankHttpError(e))
  }
}
