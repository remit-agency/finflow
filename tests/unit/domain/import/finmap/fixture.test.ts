import { describe, expect, it } from 'vitest'
import { matchColumns } from '@/lib/domain/import/finmap/columns'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import type { FinmapExisting, FinmapOptions } from '@/lib/domain/import/finmap/types'
import { buildFinmapTable, FINMAP_HEADER } from '@/tests/helpers/finmap-fixture'
import { makeXlsx } from '@/tests/helpers/make-xlsx'

const EMPTY: FinmapExisting = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const options = (over: Partial<FinmapOptions> = {}): FinmapOptions => ({ includePlanned: true, pairTransfers: true, today: '2026-11-20', ...over })

describe('buildFinmapTable (synthetic Finmap export)', () => {
  it('writes the Polish header with look-alike letters that the reader folds back to the export names', () => {
    expect(FINMAP_HEADER.some((h) => /[Ѐ-ӿ]/.test(h))).toBe(true)
    expect(matchColumns(FINMAP_HEADER).missing).toEqual([])
  })

  it('is deterministic for the same options and changes with the seed', () => {
    const a = buildFinmapTable({ rows: 300, accounts: 4 })
    expect(buildFinmapTable({ rows: 300, accounts: 4 })).toEqual(a)
    expect(buildFinmapTable({ rows: 300, accounts: 4, seed: 7 })).not.toEqual(a)
  })

  it('has the header and exactly the requested number of data rows, newest first', () => {
    const table = buildFinmapTable({ rows: 500, accounts: 3, days: 90 })
    expect(table.length).toBe(501)
    const { rows, issues } = parseFinmapTable(table)
    expect(issues).toEqual([])
    expect(rows.length).toBe(500)
    const days = rows.map((r) => r.paymentDay ?? '')
    expect([...days].sort().reverse()).toEqual(days)
  })

  it('reads and plans with every row accounted for, and writes transfer pairs, categories, tags, periods and comments', () => {
    const table = buildFinmapTable({ rows: 600, accounts: 3, pairEvery: 40 })
    const { rows } = parseFinmapTable(table)
    const plan = planFinmap(rows, EMPTY, options())
    const c = plan.counts
    expect(c.income + c.expense + 2 * c.transfer + Object.values(c.refused).reduce((a, b) => a + b, 0)).toBe(600)
    expect(c.transfer).toBeGreaterThan(0)
    expect(plan.create.categories.some((k) => k.child !== null)).toBe(true)
    expect(plan.create.tags.length).toBeGreaterThan(0)
    expect(plan.operations.some((op) => op.accrual !== null)).toBe(true)
    expect(plan.operations.some((op) => op.description !== null)).toBe(true)
  })

  it('writes the rows dated after today as planned operations when asked', () => {
    const table = buildFinmapTable({ rows: 120, accounts: 2, future: 10 })
    const { rows } = parseFinmapTable(table)
    expect(planFinmap(rows, EMPTY, options({ includePlanned: true })).counts.planned).toBe(10)
    expect(planFinmap(rows, EMPTY, options({ includePlanned: false })).counts.planned).toBe(0)
  })

  it('survives the xlsx round trip: the table written as a workbook reads back as the same cells', () => {
    const table = buildFinmapTable({ rows: 80, accounts: 2 })
    const back = readXlsxTable(makeXlsx(table))
    expect(back).toEqual(table)
  })
})
