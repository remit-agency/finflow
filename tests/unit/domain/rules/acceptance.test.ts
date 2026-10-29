import { describe, expect, it } from 'vitest'
import { applyRules } from '@/lib/domain/rules/match'
import { FIXTURE_RULES, fixtureRows } from './fixture'

describe('acceptance: 300 Polish bank rows and 10 rules', () => {
  const rows = fixtureRows()
  const results = rows.map((row) => ({ row, out: applyRules(FIXTURE_RULES, row.op) }))

  it('has 300 rows and 10 rules', () => {
    expect(rows).toHaveLength(300)
    expect(FIXTURE_RULES).toHaveLength(10)
  })

  it('leaves fewer than 20% of the rows without a category', () => {
    const uncategorised = results.filter(({ out }) => out.categoryId === undefined).length
    expect(uncategorised / rows.length).toBeLessThan(0.2)
    expect(uncategorised).toBe(30)
  })

  it('gives every row the category its template expects, never a wrong one', () => {
    for (const { row, out } of results) {
      expect(out.categoryId ?? null, `${row.op.bankName ?? ''} | ${row.op.remittance ?? ''}`).toBe(row.expected)
    }
  })

  it('uses every rule, and ZUS and the tax office also get their system counterparty', () => {
    expect(new Set(results.flatMap(({ out }) => out.applied.map((a) => a.id))).size).toBe(10)
    expect(results.filter(({ out }) => out.counterpartyId === 'system_zus')).toHaveLength(15)
    expect(results.filter(({ out }) => out.counterpartyId === 'system_us')).toHaveLength(30)
  })
})
