import { describe, expect, it } from 'vitest'
import { parseBankInfo } from '@/lib/domain/ledger/doc'

describe('parseBankInfo', () => {
  it('reads a bank account block', () => {
    expect(parseBankInfo({ accountRef: 'ba1', entryReference: 'r1' })).toEqual({ accountRef: 'ba1', entryReference: 'r1' })
  })
  it('reads a file import block without accountRef', () => {
    expect(parseBankInfo({ importId: 'imp1', counterpartyName: 'ACME', remittance: 'FV 1' })).toEqual({ importId: 'imp1', counterpartyName: 'ACME', remittance: 'FV 1' })
  })
  it('refuses a block with neither', () => {
    expect(parseBankInfo({ entryReference: 'r1' })).toBeNull()
    expect(parseBankInfo(null)).toBeNull()
  })
})
