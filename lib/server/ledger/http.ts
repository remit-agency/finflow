import { LedgerError, type LedgerErrorCode } from '@/lib/domain/ledger/errors'
import { FxError, type FxErrorCode } from '@/lib/server/fx/types'
import { HttpError } from '@/lib/server/http-error'

const LEDGER_STATUS: Record<LedgerErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  account_not_found: 422,
  category_not_found: 422,
  counterparty_not_found: 422,
  counterparty_archived: 422,
  currency_mismatch: 422,
  future_actual: 422,
  account_has_operations: 409,
  account_linked_to_bank: 409,
  currency_locked: 409,
  ledger_busy: 409,
  conflict: 409,
  bank_locked: 422,
  tag_not_found: 422,
  tag_archived: 422,
  not_eligible: 422,
}

const FX_STATUS: Record<FxErrorCode, [number, string]> = {
  invalid_params: [400, 'invalid_input'],
  unsupported_currency: [422, 'rate_unavailable'],
  no_rate_before: [422, 'rate_unavailable'],
  provider_unavailable: [503, 'provider_unavailable'],
}

/** LedgerError and FxError become an HttpError with a short code; everything else passes through unchanged. */
export function toHttpError(e: unknown): unknown {
  if (e instanceof LedgerError) return new HttpError(LEDGER_STATUS[e.code], e.code)
  if (e instanceof FxError) {
    const [status, message] = FX_STATUS[e.code]
    return new HttpError(status, message)
  }
  return e
}

/**
 * The short code of a refused write for a result per operation (bulk changes, transfers): a ledger or rate refusal (a 4xx,
 * or the 503 of an unavailable rate). Null for anything unexpected, which the caller logs and reports as `unknown`.
 */
export function refusalCode(e: unknown): string | null {
  const mapped = toHttpError(e)
  // The short code is the error message (`new HttpError(status, code, extra?)`).
  return mapped instanceof HttpError && (mapped.status < 500 || mapped.status === 503) ? mapped.message : null
}
