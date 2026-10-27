import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { HttpError } from '@/lib/server/http-error'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'

function asHttp(e: unknown): HttpError {
  const out = toCounterpartyHttpError(e)
  expect(out).toBeInstanceOf(HttpError)
  return out as HttpError
}

describe('toCounterpartyHttpError', () => {
  it.each([
    ['invalid_input', 400],
    ['not_found', 404],
    ['duplicate', 409],
    ['limit', 409],
    ['conflict', 409],
    ['lookup_unavailable', 502],
  ] as const)('%s -> %i with the code as the message', (code, status) => {
    const e = asHttp(new CounterpartyError(code))
    expect(e.status).toBe(status)
    expect(e.message).toBe(code)
    expect(e.extra).toBeUndefined()
  })

  it('passes the field and the existing id on', () => {
    const e = asHttp(new CounterpartyError('duplicate', { field: 'nip', existingId: 'c1' }))
    expect(e.extra).toEqual({ field: 'nip', existingId: 'c1' })
    expect(asHttp(new CounterpartyError('invalid_input', { field: 'ibans' })).extra).toEqual({ field: 'ibans' })
  })

  it('hands ledger errors to the ledger mapping', () => {
    const e = asHttp(new LedgerError('account_not_found'))
    expect(e.status).toBe(422)
  })

  it('leaves unknown errors alone', () => {
    const boom = new Error('boom')
    expect(toCounterpartyHttpError(boom)).toBe(boom)
  })
})
