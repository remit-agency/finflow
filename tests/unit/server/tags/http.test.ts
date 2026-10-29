import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { TagError } from '@/lib/domain/tags/errors'
import { HttpError } from '@/lib/server/http-error'
import { toTagHttpError } from '@/lib/server/tags/http'

describe('toTagHttpError', () => {
  it.each<[TagError, number, Record<string, unknown> | undefined]>([
    [new TagError('invalid_input', { field: 'name' }), 400, { field: 'name' }],
    [new TagError('not_found'), 404, undefined],
    [new TagError('duplicate', { field: 'name', existingId: 'tg0' }), 409, { field: 'name', existingId: 'tg0' }],
    [new TagError('limit_reached'), 409, undefined],
  ])('%s', (error, status, extra) => {
    const mapped = toTagHttpError(error) as HttpError
    expect(mapped).toBeInstanceOf(HttpError)
    expect(mapped.status).toBe(status)
    expect(mapped.message).toBe(error.code)
    expect(mapped.extra).toEqual(extra)
  })

  it('passes a ledger error to the ledger mapping and leaves anything else alone', () => {
    expect((toTagHttpError(new LedgerError('ledger_busy')) as HttpError).status).toBe(409)
    const other = new Error('boom')
    expect(toTagHttpError(other)).toBe(other)
  })
})
