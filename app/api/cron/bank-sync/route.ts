import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { bearerMatches } from '@/lib/server/cron-auth'
import { errorResponse } from '@/lib/server/http-error'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MIN_SECRET_LENGTH = 32

// POST /api/cron/bank-sync  (GitHub Actions, every hour)  Authorization: Bearer <BANK_CRON_SECRET>
// Refreshes the linked bank accounts that are due in the current slot (08:00, 13:00, 17:00 Warsaw) -> the counts.
// No session here: the secret is the only way in, and without a configured secret the route does nothing.
export async function POST(req: Request) {
  try {
    const secret = process.env.BANK_CRON_SECRET
    if (!secret || secret.length < MIN_SECRET_LENGTH) return new Response(null, { status: 503 })
    if (!bearerMatches(req.headers.get('authorization'), secret)) return new Response(null, { status: 401 })
    const summary = await banking.runBackgroundSync(backgroundBankDeps())
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
