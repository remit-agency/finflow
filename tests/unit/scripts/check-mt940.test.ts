import { describe, expect, it } from 'vitest'
import { maskAccount, reportLines, shortText } from '@/scripts/lib/check-mt940'
import { parseMt940 } from '@/lib/domain/import/mt940'

const STATEMENT = `:20:X
:25:/PL61109010140000071219812874
:60F:C261001PLN100,00
:61:261002D10,00NTRFNONREF//R1
:86:020~00PRZELEW~20Zakup papieru
:61:261003C5,00NTRFNONREF
:62F:C261003PLN95,00
`

describe('check:mt940 report', () => {
  it('keeps only the last 4 characters of an account number', () => {
    expect(maskAccount('PL61109010140000071219812874')).toBe('…2874')
    expect(maskAccount(null)).toBe('none')
  })

  it('cuts text to 20 characters and marks the cut', () => {
    expect(shortText('Faktura FV/10/2026 za uslugi', 20)).toBe('Faktura FV/10/2026 z…')
    expect(shortText('Krótki', 20)).toBe('Krótki')
    expect(shortText(null, 20)).toBe('–')
  })

  it('reports counts, reconciliation, null counts and the first operations, without the full account number', () => {
    const result = parseMt940(STATEMENT)
    const lines = reportLines({ name: 'sample.sta', encoding: 'utf-8', result })
    const text = lines.join('\n')

    expect(lines[0]).toBe('== sample.sta · encoding: utf-8 · statements: 1 · operations: 2')
    expect(text).toContain('issues: none')
    expect(text).toContain('reconciliation: 0')
    expect(text).toContain('without counterparty: 2 · without remittance: 1')
    expect(text).toContain('Zakup papieru')
    expect(text).not.toContain('PL61109010140000071219812874')
    expect(text).toContain('…2874')
  })

  it('lists issues by code and line only', () => {
    const result = parseMt940(':20:X\n:61:BROKEN\n')
    const text = reportLines({ name: 'bad.sta', encoding: 'utf-8', result }).join('\n')
    expect(text).toMatch(/issues: .*bad_61 line \d+/)
    expect(text).not.toContain('tag')
  })
})
