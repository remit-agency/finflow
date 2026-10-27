import { CounterpartyError, type CounterpartyErrorCode } from '@/lib/domain/counterparties/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const STATUS: Record<CounterpartyErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  duplicate: 409,
  limit: 409,
  conflict: 409,
  lookup_unavailable: 502,
}

/** A CounterpartyError becomes an HttpError (code, plus `field` and `existingId` when set); others go to the ledger mapping. */
export function toCounterpartyHttpError(e: unknown): unknown {
  if (e instanceof CounterpartyError) {
    const extra: Record<string, unknown> = {}
    if (e.field !== undefined) extra.field = e.field
    if (e.existingId !== undefined) extra.existingId = e.existingId
    return new HttpError(STATUS[e.code], e.code, Object.keys(extra).length > 0 ? extra : undefined)
  }
  return toHttpError(e)
}
