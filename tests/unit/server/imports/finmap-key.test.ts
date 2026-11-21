import { describe, expect, it } from 'vitest'
import { opIdentityParts } from '@/lib/domain/import/identity'
import type { ImportOp } from '@/lib/domain/import/types'
import { finmapKey, finmapTxId } from '@/lib/server/imports/finmap/key'
import { importKey } from '@/lib/server/imports/key'

const identity = ['2026-10-20', 'expense', '12500', 'Czynsz', 'Kwiecień'] as const

describe('finmapKey', () => {
  it('gives the same key to the same operation, 32 hex characters', () => {
    const key = finmapKey('a1', null, identity, 0)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(finmapKey('a1', null, [...identity], 0)).toBe(key)
  })

  it('differs for another account, another target account, another ordinal or another identity string', () => {
    const key = finmapKey('a1', null, identity, 0)
    expect(finmapKey('a2', null, identity, 0)).not.toBe(key)
    expect(finmapKey('a1', 'a2', identity, 0)).not.toBe(key)
    expect(finmapKey('a1', null, identity, 1)).not.toBe(key)
    expect(finmapKey('a1', null, ['2026-10-20', 'expense', '12501', 'Czynsz', 'Kwiecień'], 0)).not.toBe(key)
  })

  it('differs from the statement key of the MT940 import for the same strings', () => {
    const op: ImportOp = { day: '2026-10-20', type: 'expense', amountMinor: 12_500, reference: 'R1', counterpartyName: 'Czynsz', remittance: 'Kwiecień', ordinal: 0 }
    expect(finmapKey('a1', null, opIdentityParts(op), 0)).not.toBe(importKey('a1', op))
  })

  it('names the operation with the fm_ prefix', () => {
    expect(finmapTxId('abc')).toBe('fm_abc')
  })
})
