// lib/domain/reports/pl.ts
// P&L by recognition date (S12): the months of the period are the columns, a row per category (the S10f rule) with a value
// per month, totals, profit, and «Виключено з аналітики». An accrual period was spread over its months by the ledger
// (`allocatePeriod`), and over the days of a partial month by `operationRollups` (`accrualShare`).
import { monthsBetween } from '@/lib/domain/ledger/days'
import { byTypeThenAmount, rowOfStored } from './cashflow'
import type { CategoryTypes } from '@/lib/domain/analytics-filter/kinds'
import type { CategoryAmounts, PLLine, PLReport, ReportFacts, Totals } from './types'

export interface PLInput {
  from: string
  to: string
  includeExcluded: boolean
  categoryTypes: CategoryTypes
}

export type PLCore = Pick<PLReport, 'months' | 'rows' | 'totals' | 'excluded' | 'includeExcluded' | 'excludedCounted'>

export function buildPLCore(facts: ReportFacts, input: PLInput): PLCore {
  const months = monthsBetween(input.from, input.to)
  const column = new Map(months.map((month, i) => [month, i]))
  const lines = new Map<string, PLLine>()
  const excluded: Totals = { incomeBase: 0, expenseBase: 0 }
  let excludedCounted = false

  const count = (source: Map<string, Map<string, CategoryAmounts>>, isExcluded: boolean): void => {
    for (const [month, categories] of source) {
      const i = column.get(month)
      if (i === undefined) continue
      for (const [stored, a] of categories) {
        for (const [type, value] of [['income', a.incomeBase], ['expense', a.expenseBase]] as const) {
          if (value === 0) continue
          if (isExcluded && !input.includeExcluded) {
            if (type === 'income') excluded.incomeBase += value
            else excluded.expenseBase += value
            continue
          }
          if (isExcluded) excludedCounted = true
          const row = rowOfStored(type, stored, input.categoryTypes)
          const key = `${type}|${row}`
          const line = lines.get(key) ?? { row, type, values: months.map(() => 0), total: 0 }
          line.values[i] += value
          line.total += value
          lines.set(key, line)
        }
      }
    }
  }
  count(facts.pl, false)
  count(facts.excludedPl, true)

  const rows = [...lines.values()].filter((l) => l.total !== 0).sort(byTypeThenAmount((l: PLLine) => l.total))
  const incomeBase = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.total, 0)
  const expenseBase = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.total, 0)
  return {
    months,
    rows,
    totals: { incomeBase, expenseBase, profitBase: incomeBase - expenseBase },
    excluded: input.includeExcluded ? null : excluded,
    includeExcluded: input.includeExcluded,
    excludedCounted,
  }
}
