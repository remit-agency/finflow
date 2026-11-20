// Pure report of `check:finmap` (no I/O): what one Finmap export looks like after reading, parsing and planning. The lines carry
// counts, shapes, periods and timings only: never a name, a comment or an amount of the file.
import type { TableIssue, FinmapPlan, FinmapRefusal } from '@/lib/domain/import/finmap/types'

export interface FinmapCheck {
  name: string
  /** Data rows the parser read (0 when the table was refused). */
  rowsRead: number
  issues: TableIssue[]
  /** The plan of the rows; null when the table was refused. */
  plan: FinmapPlan | null
  timings: { readMs: number; parseMs: number; planMs: number }
}

const REFUSALS: readonly FinmapRefusal[] = ['date', 'amount', 'account', 'name', 'planned_off', 'accrual_after_horizon']

function issueLine(issues: readonly TableIssue[]): string {
  return issues.length === 0 ? 'issues: none' : `issues: ${issues.map((i) => i.code).join(', ')}`
}

/** The report of one file as lines. */
export function reportLines(check: FinmapCheck): string[] {
  const unknown = check.issues.find((i) => i.code === 'unknown_layout')
  const header = unknown ? `header: not matched · missing: ${(unknown.missing ?? []).join(', ')}` : 'header: matched'
  const lines = [`== ${check.name} · rows read: ${check.rowsRead} · ${header}`, `  ${issueLine(check.issues)}`]

  const plan = check.plan
  if (plan === null) {
    lines.push('  operations: none (the table was refused)')
  } else {
    const c = plan.counts
    const refused = REFUSALS.map((r) => `${r} ${c.refused[r] ?? 0}`).join(' · ')
    const warnings = `commentCut ${c.warnings.commentCut} · subcounterparty ${c.warnings.subcounterparty} · project ${c.warnings.project} · accrualIgnored ${c.warnings.accrualIgnored} · categoryIgnored ${c.warnings.categoryIgnored}`
    const subcategories = plan.create.categories.filter((k) => k.child !== null).length
    const period = plan.period === null ? 'none' : `${plan.period.from} – ${plan.period.to}`
    lines.push(`  income: ${c.income} · expense: ${c.expense} · transfer: ${c.transfer} · planned: ${c.planned} · operations: ${plan.operations.length}`)
    lines.push(`  refused: ${refused}`)
    lines.push(`  pairCandidatesLeft: ${c.pairCandidatesLeft}`)
    lines.push(`  warnings: ${warnings}`)
    lines.push(
      `  would create: accounts ${plan.create.accounts.length} · categories ${plan.create.categories.length} (subcategories ${subcategories}) · counterparties ${plan.create.counterparties.length} · tags ${plan.create.tags.length}`,
    )
    lines.push(`  period: ${period}`)
  }
  const t = check.timings
  lines.push(`  ms: read ${t.readMs} · parse ${t.parseMs} · plan ${t.planMs}`)
  return lines
}
