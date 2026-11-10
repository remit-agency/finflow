import 'server-only'
import { RecurringError, type RecurringErrorCode } from '@/lib/domain/recurring/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const STATUS: Record<RecurringErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  limit_reached: 409,
}

/** A RecurringError becomes an HttpError (the code, plus `field` when set); everything else goes to the ledger mapping. */
export function toRecurringHttpError(e: unknown): unknown {
  if (e instanceof RecurringError) return new HttpError(STATUS[e.code], e.code, e.field === undefined ? undefined : { field: e.field })
  return toHttpError(e)
}
