import { describe, expect, it } from 'vitest'
import { applyRules } from '@/lib/domain/rules/match'
import { FIXTURE_RULES, fixtureRows } from './fixture'

describe('acceptance: 300 Polish bank rows of a small business and 10 rules', () => {
  const rows = fixtureRows()
  const results = rows.map((row) => ({ row, out: applyRules(FIXTURE_RULES, row.op) }))
  const uncategorised = results.filter(({ out }) => out.categoryId === undefined)

  it('has 300 rows and 10 rules', () => {
    expect(rows).toHaveLength(300)
    expect(FIXTURE_RULES).toHaveLength(10)
  })

  it('leaves fewer than 20% of the rows without a category (the roadmap criterion)', () => {
    expect(uncategorised.length / rows.length).toBeLessThan(0.2)
  })

  it('the uncategorised rows are the 44 one-off counterparties and 4 negatives, and nothing else (16%)', () => {
    const oneOffs = rows.filter((r) => r.oneOff)
    expect(oneOffs).toHaveLength(44)
    expect(new Set(oneOffs.map((r) => r.op.bankName)).size).toBe(44)
    expect(uncategorised).toHaveLength(48)
    expect(uncategorised.filter(({ row }) => row.oneOff)).toHaveLength(44)
    expect(uncategorised.filter(({ row }) => !row.oneOff).map(({ row }) => row.label).sort()).toEqual([
      'Allegro refund (excluded by «zwrot»)',
      'Allegro refund (excluded by «zwrot»)',
      'income refund',
      'income refund',
    ])
  })

  it('gives every row the category its template expects, never a wrong one (the bank fees and the BPH and ZUSZKA negatives included)', () => {
    for (const { row, out } of results) {
      expect(out.categoryId ?? null, `${row.label}: ${row.op.bankName ?? ''} | ${row.op.remittance ?? ''}`).toBe(row.expected)
    }
  })

  it('uses every rule, and ZUS and the tax office also get their system counterparty', () => {
    expect(new Set(results.flatMap(({ out }) => out.applied.map((a) => a.id))).size).toBe(10)
    expect(results.filter(({ out }) => out.counterpartyId === 'system_zus')).toHaveLength(12)
    expect(results.filter(({ out }) => out.counterpartyId === 'system_us')).toHaveLength(8)
  })
})
