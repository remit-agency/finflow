import { CRON_ROUTE_BUDGET_MS, RECURRING_CRON_BUDGET_MS } from '@/lib/domain/recurring/types'
import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { bearerMatches } from '@/lib/server/cron-auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MIN_SECRET_LENGTH = 32

// POST /api/cron/bank-sync  (GitHub Actions, every hour)  Authorization: Bearer <BANK_CRON_SECRET>
// Refreshes the linked bank accounts that are due in the current slot (08:00, 13:00, 17:00 Warsaw), then fills the planned
// payments of the day (S11) -> the bank counts, and the planned payments' counts under `recurring`.
// No session here: the secret is the only way in, and without a configured secret the route does nothing.
export async function POST(req: Request) {
  const started = Date.now()
  try {
    const secret = process.env.BANK_CRON_SECRET
    if (!secret || secret.length < MIN_SECRET_LENGTH) return new Response(null, { status: 503 })
    if (!bearerMatches(req.headers.get('authorization'), secret)) return new Response(null, { status: 401 })
    let bank: Awaited<ReturnType<typeof banking.runBackgroundSync>> | null = null
    let bankError: unknown = null
    try {
      bank = await banking.runBackgroundSync(backgroundBankDeps())
    } catch (e) {
      bankError = e
    }
    // S11: the bank refresh goes first (the bank's daily limits matter more). The planned payments get what is left of the
    // route's time, at most RECURRING_CRON_BUDGET_MS; an hour without time is caught up by the next call. They never throw.
    const left = CRON_ROUTE_BUDGET_MS - (Date.now() - started)
    const plans = await recurring.cron(Math.max(0, Math.min(RECURRING_CRON_BUDGET_MS, left)))
    if (bankError !== null || bank === null) {
      // The job turns red either way; the planned payments' counts (no names) stay in the log with the failure.
      console.error('bank-sync: the bank refresh failed', { recurring: plans })
      return errorResponse(bankError)
    }
    return Response.json({ ...bank, recurring: plans }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
