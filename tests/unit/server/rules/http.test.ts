import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RuleError } from '@/lib/domain/rules/errors'
import { HttpError } from '@/lib/server/http-error'
import { toRuleHttpError } from '@/lib/server/rules/http'

describe('toRuleHttpError', () => {
  it.each<[RuleError, number]>([
    [new RuleError('invalid_input', 'name'), 400],
    [new RuleError('not_found'), 404],
    [new RuleError('limit_reached'), 409],
    [new RuleError('conflict'), 409],
    [new RuleError('category_not_found', 'actions.categoryId'), 422],
    [new RuleError('counterparty_not_found', 'actions.counterpartyId'), 422],
    [new RuleError('counterparty_archived', 'actions.counterpartyId'), 422],
    [new RuleError('tag_not_found', 'actions.tagIds'), 422],
    [new RuleError('tag_archived', 'actions.tagIds'), 422],
  ])('%s', (error, status) => {
    const mapped = toRuleHttpError(error) as HttpError
    expect(mapped).toBeInstanceOf(HttpError)
    expect(mapped.status).toBe(status)
    expect(mapped.message).toBe(error.code)
    expect(mapped.extra).toEqual(error.field === undefined ? undefined : { field: error.field })
  })

  it('passes a ledger error to the ledger mapping and leaves anything else alone', () => {
    expect((toRuleHttpError(new LedgerError('conflict')) as HttpError).status).toBe(409)
    const other = new Error('boom')
    expect(toRuleHttpError(other)).toBe(other)
  })
})
