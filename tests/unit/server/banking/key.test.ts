import { describe, expect, it } from 'vitest'
import type { EbTransaction } from '@/lib/domain/banking/map'
import { bankTxKeys } from '@/lib/server/banking/key'

const tx = (over: Partial<EbTransaction> = {}): EbTransaction => ({
  booking_date: '2026-10-20', transaction_amount: { amount: '10.00', currency: 'PLN' }, credit_debit_indicator: 'DBIT',
  creditor: { name: 'ACME' }, remittance_information: ['Faktura'], ...over,
})

describe('bankTxKeys', () => {
  it('uses the bank reference when there is one: stable, 32 hex chars, scoped to the bank account', () => {
    const [a] = bankTxKeys('ba1', [tx({ entry_reference: 'R1' })])
    const [b] = bankTxKeys('ba1', [tx({ entry_reference: 'R1', booking_date: '2026-10-21' })])
    const [c] = bankTxKeys('ba2', [tx({ entry_reference: 'R1' })])
    expect(a.key).toMatch(/^[0-9a-f]{32}$/)
    expect(b.key).toBe(a.key) // a later correction of the date does not make a new operation
    expect(c.key).not.toBe(a.key)
  })
  it('falls back to transaction_id, then to a content fingerprint', () => {
    const [byId] = bankTxKeys('ba1', [tx({ transaction_id: 'T1' })])
    const [byRef] = bankTxKeys('ba1', [tx({ entry_reference: 'T1' })])
    expect(byId.key).toBe(byRef.key)
    const [f1] = bankTxKeys('ba1', [tx()])
    const [f2] = bankTxKeys('ba1', [tx()])
    expect(f1.key).toBe(f2.key)
    expect(bankTxKeys('ba1', [tx({ remittance_information: ['Inna'] })])[0].key).not.toBe(f1.key)
  })
  it('two identical operations without a reference get different keys, the same on every read', () => {
    const run = () => bankTxKeys('ba1', [tx(), tx(), tx({ transaction_amount: { amount: '99.00', currency: 'PLN' } })]).map((e) => e.key)
    const keys = run()
    expect(new Set(keys).size).toBe(3)
    expect(run()).toEqual(keys)
  })
  it('ignores case and spacing in the text of a fingerprint', () => {
    const a = bankTxKeys('ba1', [tx({ remittance_information: ['Faktura  12'] })])[0].key
    const b = bankTxKeys('ba1', [tx({ remittance_information: [' faktura 12 '] })])[0].key
    expect(a).toBe(b)
  })
})
