import { describe, expect, it } from 'vitest'
import { EXPORT_COLLECTIONS, isExportCollection, parseExportCounts } from '@/lib/domain/export/collections'

const TECHNICAL = ['rollups', 'ledger', 'counterpartyKeys', 'tagKeys', 'bankSeen', 'bankAccounts', 'recurringDone', 'importLocks']

describe('EXPORT_COLLECTIONS', () => {
  it('has no duplicates', () => expect(new Set(EXPORT_COLLECTIONS).size).toBe(EXPORT_COLLECTIONS.length))
  it('contains no derived or technical collection', () => {
    for (const name of TECHNICAL) expect(EXPORT_COLLECTIONS as readonly string[]).not.toContain(name)
  })
  it('rejects a technical name', () => expect(isExportCollection('bankSeen')).toBe(false))
  it('accepts a user-data name', () => expect(isExportCollection('transactions')).toBe(true))
  it('rejects a non-string', () => expect(isExportCollection(5)).toBe(false))
})

describe('parseExportCounts', () => {
  it('accepts known collections with non-negative integers', () =>
    expect(parseExportCounts({ counts: { transactions: 1200, audit: 0 } })).toEqual({ transactions: 1200, audit: 0 }))
  it('accepts an empty counts object', () => expect(parseExportCounts({ counts: {} })).toEqual({}))
  it('rejects an unknown or technical key', () => {
    expect(parseExportCounts({ counts: { bankSeen: 1 } })).toBeNull()
    expect(parseExportCounts({ counts: { nope: 1 } })).toBeNull()
  })
  it('rejects negative, fractional, non-finite and non-number values', () => {
    for (const v of [-1, 1.5, NaN, Infinity, '3', null, 2 ** 60]) expect(parseExportCounts({ counts: { transactions: v } })).toBeNull()
  })
  it('rejects a body without a counts object', () => {
    for (const b of [null, [], 'x', {}, { counts: null }, { counts: [] }, { counts: 3 }]) expect(parseExportCounts(b)).toBeNull()
  })
})
