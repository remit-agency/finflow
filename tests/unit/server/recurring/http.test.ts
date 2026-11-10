import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { HttpError } from '@/lib/server/http-error'
import { toRecurringHttpError } from '@/lib/server/recurring/http'

describe('toRecurringHttpError', () => {
  it.each([
    [new RecurringError('invalid_input', 'name'), 400, 'invalid_input', { field: 'name' }],
    [new RecurringError('not_found'), 404, 'not_found', undefined],
    [new RecurringError('limit_reached', 'planned'), 409, 'limit_reached', { field: 'planned' }],
  ])('maps %s', (e, status, code, extra) => {
    const mapped = toRecurringHttpError(e)
    expect(mapped).toBeInstanceOf(HttpError)
    expect(mapped).toMatchObject({ status, message: code, extra })
  })

  it('passes ledger refusals to the ledger mapping and anything else through', () => {
    expect(toRecurringHttpError(new LedgerError('category_not_found', 'categoryId'))).toMatchObject({ status: 422, message: 'category_not_found' })
    const other = new Error('boom')
    expect(toRecurringHttpError(other)).toBe(other)
  })
})
