// tests/unit/domain/journal/bulk-input.test.ts
import { describe, expect, it } from 'vitest'
import { MAX_BULK_IDS, parseBulkRequest } from '@/lib/domain/journal/bulk-input'
import { LedgerError } from '@/lib/domain/ledger/errors'

const invalid = (body: unknown) => expect(() => parseBulkRequest(body)).toThrow(LedgerError)

describe('parseBulkRequest', () => {
  it('accepts a delete', () => {
    expect(parseBulkRequest({ action: 'delete', ids: ['a', 'b'] })).toEqual({ action: 'delete', ids: ['a', 'b'] })
  })
  it('accepts an update with the allowed fields, null clears', () => {
    expect(parseBulkRequest({ action: 'update', ids: ['a'], patch: { categoryId: null, description: 'x', paymentDate: '2026-10-01' } })).toEqual({
      action: 'update',
      ids: ['a'],
      patch: { categoryId: null, description: 'x', paymentDate: '2026-10-01' },
    })
  })
  it('refuses unknown actions, fields, empty or oversized id lists, bad ids and duplicates', () => {
    invalid({ action: 'archive', ids: ['a'] })
    invalid({ action: 'update', ids: ['a'], patch: { amountMinor: 1 } })
    invalid({ action: 'update', ids: ['a'] })
    invalid({ action: 'update', ids: ['a'], patch: {} })
    invalid({ action: 'delete', ids: [] })
    invalid({ action: 'delete', ids: Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `id${i}`) })
    invalid({ action: 'delete', ids: ['a/b'] })
    invalid({ action: 'delete', ids: ['a', 'a'] })
    invalid({ action: 'delete', ids: ['a'], patch: { description: 'x' } })
    invalid({ action: 'update', ids: ['a'], patch: { paymentDate: null } })
  })

  it('accepts a tag change (S10t): add, remove or both', () => {
    expect(parseBulkRequest({ action: 'update', ids: ['a'], patch: { addTagIds: ['vat'] } })).toEqual({ action: 'update', ids: ['a'], patch: { addTagIds: ['vat'] } })
    expect(parseBulkRequest({ action: 'update', ids: ['a'], patch: { addTagIds: ['vat'], removeTagIds: ['q4'] } })).toEqual({
      action: 'update',
      ids: ['a'],
      patch: { addTagIds: ['vat'], removeTagIds: ['q4'] },
    })
  })

  it('refuses a tag change mixed with other fields, empty or oversized lists, repeats and an id in both lists', () => {
    invalid({ action: 'update', ids: ['a'], patch: { addTagIds: ['vat'], description: 'x' } })
    invalid({ action: 'update', ids: ['a'], patch: { addTagIds: [] } })
    invalid({ action: 'update', ids: ['a'], patch: { addTagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) } })
    invalid({ action: 'update', ids: ['a'], patch: { removeTagIds: ['vat', 'vat'] } })
    invalid({ action: 'update', ids: ['a'], patch: { addTagIds: ['a/b'] } })
    invalid({ action: 'update', ids: ['a'], patch: { addTagIds: ['vat'], removeTagIds: ['vat'] } })
    invalid({ action: 'update', ids: ['a'], patch: { tags: ['vat'] } })
  })
})
