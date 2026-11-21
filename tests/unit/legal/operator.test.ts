import { describe, expect, it } from 'vitest'
import { LEGAL_DRAFT, OPERATOR, operatorProblems } from '@/lib/legal/operator'

describe('operator config', () => {
  it('lists problems for empty or placeholder fields', () => {
    expect(operatorProblems({ ...OPERATOR, nip: '' })).toContain('nip')
    expect(operatorProblems({ ...OPERATOR, name: 'TODO' })).toContain('name')
  })
  it('lists no problem for a complete operator', () => {
    const complete = { ...OPERATOR, name: 'Remit Sp. z o.o.', legalForm: 'sp. z o.o.', nip: '5840000000', address: 'ul. Długa 1, 80-000 Gdańsk', rodoEmail: 'rodo@example.pl', supportEmail: 'pomoc@example.pl' }
    expect(operatorProblems(complete)).toEqual([])
  })
  it('refuses to publish without the draft marker while a field is missing', () => {
    // When the owner turns the draft marker off, every operator field must be real.
    if (!LEGAL_DRAFT) expect(operatorProblems(OPERATOR)).toEqual([])
    else expect(LEGAL_DRAFT).toBe(true)
  })
  it('names every sub-processor with a purpose and a country', () => {
    for (const p of OPERATOR.processors) {
      expect(p.name).not.toBe('')
      expect(p.purpose.pl).not.toBe('')
      expect(p.country).not.toBe('')
    }
  })
})
