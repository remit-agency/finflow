import { describe, expect, it } from 'vitest'
import { sumChecks, transferCheckLine, type TransferCheck } from '@/scripts/lib/check-transfers'

const a: TransferCheck = { scanned: 812, bankSides: 640, pairs: 7, ambiguous: 2, truncated: false, bankTransfers: 0 }
const b: TransferCheck = { scanned: 2000, bankSides: 1900, pairs: 31, ambiguous: 0, truncated: true, bankTransfers: 3 }

describe('check:transfers', () => {
  it('prints counts only, one line per company', () => {
    expect(transferCheckLine('org1', a)).toBe('org org1: 7 pair(s) to suggest, 2 ambiguous side(s), 640 bank operation(s) of 812 read, 0 transfer(s) with a bank side')
    expect(transferCheckLine('org2', b)).toBe('org org2: 31 pair(s) to suggest, 0 ambiguous side(s), 1900 bank operation(s) of 2000 read (cut at the read limit), 3 transfer(s) with a bank side')
  })

  it('adds the companies up', () => {
    expect(sumChecks([a, b])).toEqual({ scanned: 2812, bankSides: 2540, pairs: 38, ambiguous: 2, truncated: true, bankTransfers: 3 })
    expect(sumChecks([])).toEqual({ scanned: 0, bankSides: 0, pairs: 0, ambiguous: 0, truncated: false, bankTransfers: 0 })
  })
})
