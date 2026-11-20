import { describe, expect, it } from 'vitest'
import { decodeStatementBytes } from '@/lib/domain/import/decode'

describe('decodeStatementBytes', () => {
  it('reads UTF-8', () => {
    const bytes = new TextEncoder().encode('Zażółć')
    expect(decodeStatementBytes(bytes)).toEqual({ text: 'Zażółć', encoding: 'utf-8' })
  })
  it('falls back to Windows-1250 when the bytes are not UTF-8', () => {
    const bytes = Uint8Array.from([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6]) // Za + ż ó ł ć in windows-1250
    expect(decodeStatementBytes(bytes)).toEqual({ text: 'Zażółć', encoding: 'windows-1250' })
  })
  it('drops a UTF-8 byte order mark', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x3a, 0x32, 0x30, 0x3a])
    expect(decodeStatementBytes(bytes).text).toBe(':20:')
  })
})
