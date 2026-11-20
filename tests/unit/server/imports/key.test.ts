import { describe, expect, it } from 'vitest'
import type { EbTransaction } from '@/lib/domain/banking/map'
import type { ImportOp } from '@/lib/domain/import/types'
import { importKey } from '@/lib/server/imports/key'
import { bankTxKeys } from '@/lib/server/banking/key'

const op = (over: Partial<ImportOp> = {}): ImportOp => ({
  day: '2026-10-20',
  type: 'income',
  amountMinor: 10_000,
  reference: 'R1',
  counterpartyName: 'ACME',
  remittance: 'Faktura 12/10',
  ordinal: 0,
  ...over,
})

describe('importKey', () => {
  it('gives the same key to the same line of the same account, 32 hex characters', () => {
    const key = importKey('a1', op())
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(importKey('a1', op())).toBe(key)
    // Only the spacing and case of the text differ: the same operation.
    expect(importKey('a1', op({ remittance: '  faktura   12/10 ' }))).toBe(key)
  })

  it('differs for another account, another ordinal or another amount', () => {
    const key = importKey('a1', op())
    expect(importKey('a2', op())).not.toBe(key)
    expect(importKey('a1', op({ ordinal: 1 }))).not.toBe(key)
    expect(importKey('a1', op({ amountMinor: 10_001 }))).not.toBe(key)
  })

  it('differs for a line without a reference that has another text', () => {
    const noRef = importKey('a1', op({ reference: null }))
    expect(importKey('a1', op({ reference: null, remittance: 'Inna' }))).not.toBe(noRef)
  })

  it('is in its own namespace: not the bankTxKeys of an equal bank line', () => {
    const bankTx: EbTransaction = {
      entry_reference: 'R1',
      booking_date: '2026-10-20',
      transaction_amount: { amount: '100.00', currency: 'PLN' },
      credit_debit_indicator: 'CRDT',
    }
    const [bank] = bankTxKeys('a1', [bankTx])
    expect(importKey('a1', op())).not.toBe(bank.key)
  })
})
