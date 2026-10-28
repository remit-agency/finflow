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
})
