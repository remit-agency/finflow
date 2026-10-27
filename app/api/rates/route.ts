import { requireUser } from '@/lib/server/auth'
import { FxError, resolveRate } from '@/lib/server/fx'
import { isDay } from '@/lib/domain/ledger/days'
import { isCurrencyCode } from '@/lib/server/fx/rates'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { enforceRateLimit, RATES_LIMITS } from '@/lib/server/rate-limit-guard'

export const runtime = 'nodejs'

const PARAMS = ['from', 'to', 'date']
const STATUS = {
  invalid_params: 400,
  unsupported_currency: 404,
  no_rate_before: 404,
  provider_unavailable: 503,
} as const

// GET /api/rates?from=EUR&to=PLN&date=2026-10-27
// NBP table A rate for converting `from` into `to` on `date` (S04). Public data, so any signed-in
// user may ask; no company is involved.
export async function GET(req: Request) {
  try {
    const { uid } = await requireUser(req)

    const params = new URL(req.url).searchParams
    const keys = [...params.keys()]
    if (keys.length !== PARAMS.length || !PARAMS.every((k) => params.getAll(k).length === 1)) {
      throw new HttpError(400, 'invalid_params')
    }

    const from = params.get('from')
    const to = params.get('to')
    const date = params.get('date')
    if (!isCurrencyCode(from) || !isCurrencyCode(to) || !isDay(date)) {
      throw new HttpError(400, 'invalid_params')
    }

    await enforceRateLimit(uid, 'rates', RATES_LIMITS)
    const snapshot = await resolveRate(from, to, date)
    return Response.json(snapshot, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (e) {
    if (e instanceof FxError) return errorResponse(new HttpError(STATUS[e.code], e.code))
    return errorResponse(e)
  }
}
