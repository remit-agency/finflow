import 'server-only'
import { ReportError } from '@/lib/domain/reports/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

/** A ReportError becomes an HttpError (400 with `field`, 422 with its code and `cap`); everything else goes to the ledger mapping. */
export function toReportHttpError(e: unknown): unknown {
  if (e instanceof ReportError) {
    if (e.code === 'invalid_input') return new HttpError(400, 'invalid_input', e.field === undefined ? undefined : { field: e.field })
    return new HttpError(422, e.code, { cap: e.cap })
  }
  return toHttpError(e)
}
