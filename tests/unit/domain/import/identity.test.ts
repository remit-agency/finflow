import { describe, expect, it } from 'vitest'
import { opIdentityParts, withOrdinals } from '@/lib/domain/import/identity'
import type { RawOp } from '@/lib/domain/import/types'

const op = (over: Partial<RawOp> = {}): RawOp => ({ day: '2026-10-02', type: 'expense', amountMinor: 500, reference: null, counterpartyName: 'Kawa', remittance: 'kawa', ...over })

describe('withOrdinals', () => {
  it('numbers identical operations in file order', () => {
    expect(withOrdinals([op(), op(), op({ amountMinor: 600 }), op()]).map((o) => o.ordinal)).toEqual([0, 1, 0, 2])
  })
  it('treats case and spacing of the text as the same', () => {
    expect(withOrdinals([op({ remittance: 'Kawa  X' }), op({ remittance: 'kawa x' })]).map((o) => o.ordinal)).toEqual([0, 1])
  })
})

describe('opIdentityParts', () => {
  it('uses the reference when there is one, the text otherwise', () => {
    expect(opIdentityParts(op({ reference: 'R1' }))).toEqual(['2026-10-02', '500', 'expense', 'ref', 'R1'])
    expect(opIdentityParts(op())).toEqual(['2026-10-02', '500', 'expense', 'fp', 'kawa', 'kawa'])
  })
})
