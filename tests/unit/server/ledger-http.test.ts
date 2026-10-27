import { describe, expect, it } from 'vitest'
import { LedgerError, type LedgerErrorCode } from '@/lib/domain/ledger/errors'
import { FxError, type FxErrorCode } from '@/lib/server/fx/types'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const LEDGER: Record<LedgerErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  account_not_found: 422,
  category_not_found: 422,
  currency_mismatch: 422,
  future_actual: 422,
  account_has_operations: 409,
  currency_locked: 409,
  ledger_busy: 409,
  conflict: 409,
}

const FX: Record<FxErrorCode, [number, string]> = {
  invalid_params: [400, 'invalid_input'],
  unsupported_currency: [422, 'rate_unavailable'],
  no_rate_before: [422, 'rate_unavailable'],
  provider_unavailable: [503, 'provider_unavailable'],
}

describe('toHttpError', () => {
  it.each(Object.entries(LEDGER))('maps LedgerError %s to status %i with the code as message', (code, status) => {
    const out = toHttpError(new LedgerError(code as LedgerErrorCode))
    expect(out).toBeInstanceOf(HttpError)
    expect((out as HttpError).status).toBe(status)
    expect((out as HttpError).message).toBe(code)
  })

  it('does not leak the offending field name into the message', () => {
    const out = toHttpError(new LedgerError('invalid_input', 'amountMinor')) as HttpError
    expect(out.message).toBe('invalid_input')
  })

  it.each(Object.entries(FX))('maps FxError %s to its status and short code', (code, [status, message]) => {
    const out = toHttpError(new FxError(code as FxErrorCode))
    expect(out).toBeInstanceOf(HttpError)
    expect((out as HttpError).status).toBe(status)
    expect((out as HttpError).message).toBe(message)
  })

  it('returns an unrelated error unchanged', () => {
    const e = new Error('boom')
    expect(toHttpError(e)).toBe(e)
  })

  it('returns an HttpError unchanged', () => {
    const e = new HttpError(403, 'forbidden')
    expect(toHttpError(e)).toBe(e)
  })

  it('returns a non-error value unchanged', () => {
    expect(toHttpError('x')).toBe('x')
  })
})
