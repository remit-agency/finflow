import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

export type BankErrorCode =
  | 'consent_expired'
  | 'rate_limited'
  | 'bank_unavailable'
  | 'bank_error'
  | 'already_running'
  | 'already_linked'
  | 'not_found'
  | 'currency_mismatch'
  | 'currency_unsupported'
  | 'invalid_input'

export class BankError extends Error {
  public readonly code: BankErrorCode
  constructor(code: BankErrorCode) {
    super(code)
    this.name = 'BankError'
    this.code = code
  }
}

const STATUS: Record<BankErrorCode, number> = {
  consent_expired: 409,
  rate_limited: 429,
  bank_unavailable: 503,
  bank_error: 502,
  already_running: 409,
  already_linked: 409,
  not_found: 404,
  currency_mismatch: 422,
  currency_unsupported: 422,
  invalid_input: 400,
}

/** BankError, LedgerError and FxError become an HttpError with a short code; anything else passes through. */
export function toBankHttpError(e: unknown): unknown {
  if (e instanceof BankError) return new HttpError(STATUS[e.code], e.code)
  return toHttpError(e)
}
