import { describe, expect, it } from 'vitest'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { reportLines, type FinmapCheck } from '@/scripts/lib/check-finmap'
import { buildFinmapTable, FINMAP_HEADER } from '@/tests/helpers/finmap-fixture'

const EMPTY = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const TIMINGS = { readMs: 12, parseMs: 3, planMs: 4 }

/** The check of a table as the script builds it: parse, plan with empty existing names, the report's input. */
function checkOf(name: string, table: string[][]): FinmapCheck {
  const { rows, issues } = parseFinmapTable(table)
  const plan = issues.length === 0 ? planFinmap(rows, EMPTY, { includePlanned: true, pairTransfers: true, today: '2026-11-20' }) : null
  return { name, rowsRead: rows.length, issues, plan, timings: TIMINGS }
}

/** The text cells that are names, comments or amounts (the export's columns after the header), split at the list separators. */
function sensitiveCells(table: string[][]): string[] {
  const out = new Set<string>()
  const cols = [4, 5, 6, 7, 8, 9, 10, 14, 15]
  for (const row of table.slice(1)) {
    for (const c of cols) {
      for (const part of (row[c] ?? '').split(/[,;]/)) {
        const t = part.trim()
        if (t.length >= 3) out.add(t)
      }
    }
  }
  return [...out]
}

describe('check:finmap report', () => {
  it('prints counts, shapes and timings, and no name, comment or amount of the table', () => {
    const table = buildFinmapTable({ rows: 400, accounts: 3, pairEvery: 30, future: 4, seed: 3 })
    const text = reportLines(checkOf('synthetic.xlsx', table)).join('\n')

    expect(text).toContain('== synthetic.xlsx')
    expect(text).toContain('rows read: 400')
    expect(text).toContain('header: matched')
    expect(text).toMatch(/income: \d+ · expense: \d+ · transfer: \d+ · planned: 4/)
    expect(text).toContain('refused: date 0')
    expect(text).toMatch(/pairCandidatesLeft: \d+/)
    expect(text).toContain('warnings: commentCut')
    expect(text).toMatch(/would create: accounts \d+ · categories \d+ \(subcategories \d+\) · counterparties \d+ · tags \d+/)
    expect(text).toContain('period: 20')
    expect(text).toContain('ms: read 12 · parse 3 · plan 4')

    for (const secret of sensitiveCells(table)) expect(text, secret).not.toContain(secret)
    // Amounts are written with two decimals in the table; no such figure may appear in the report.
    expect(text).not.toMatch(/\d+\.\d{2}\b/)
  })

  it('reports an unknown layout by its missing columns, with no data', () => {
    const table = [['Foo', 'Bar Baz'], ['Konto Testowe', '12.34']]
    const text = reportLines(checkOf('other.xlsx', table)).join('\n')
    expect(text).toContain('header: not matched · missing:')
    expect(text).toContain('issues: unknown_layout')
    expect(text).toContain('rows read: 0')
    expect(text).not.toContain('Konto Testowe')
    expect(text).not.toContain('12.34')
  })

  it('reports an empty sheet with its issue code', () => {
    const text = reportLines(checkOf('empty.xlsx', [[...FINMAP_HEADER]])).join('\n')
    expect(text).toContain('issues: empty')
  })
})
