import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { TagError } from '@/lib/domain/tags/errors'
import { HttpError } from '@/lib/server/http-error'
import { ImportError, toImportHttpError } from '@/lib/server/imports/errors'

describe('toImportHttpError', () => {
  it('answers a company limit reached by the tag or counterparty writer as 422 with the code and the entity', () => {
    const tags = toImportHttpError(new TagError('limit_reached')) as HttpError
    expect(tags).toBeInstanceOf(HttpError)
    expect(tags).toMatchObject({ status: 422, message: 'limit_reached', extra: { field: 'tags' } })

    const counterparties = toImportHttpError(new CounterpartyError('limit')) as HttpError
    expect(counterparties).toMatchObject({ status: 422, message: 'limit_reached', extra: { field: 'counterparties' } })
  })

  it('answers the setup pre-check limit as 422 with its field', () => {
    expect(toImportHttpError(new ImportError('limit_reached', 'tags'))).toMatchObject({ status: 422, message: 'limit_reached', extra: { field: 'tags' } })
  })
})
