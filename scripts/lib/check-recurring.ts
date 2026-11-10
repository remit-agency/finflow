// Pure part of scripts/check-recurring.ts (S11 rollout check). Unit-tested in Vitest.

/** What the check read for one company: counts only. */
export interface RecurringCheck {
  series: number
  active: number
  paused: number
  /** Series whose daily fill is due today or earlier. */
  due: number
  /** Planned operations before today. */
  overdue: number
  /** Planned operations of today and the next 30 days (as the page lists them, at most 50). */
  upcoming: number
  /** Plan ↔ bank pairs the journal would suggest. */
  pairs: number
  ambiguous: number
  /** A read stopped at its limit. */
  truncated: boolean
}

export function recurringCheckLine(orgId: string, c: RecurringCheck): string {
  const cut = c.truncated ? ' (cut at a read limit)' : ''
  return `org ${orgId}: ${c.series} series (${c.active} active, ${c.paused} paused, ${c.due} due), ${c.overdue} overdue plan(s), ${c.upcoming} plan(s) in the next 31 days, ${c.pairs} pair(s) to suggest, ${c.ambiguous} ambiguous side(s)${cut}`
}

export function sumRecurringChecks(checks: readonly RecurringCheck[]): RecurringCheck {
  return checks.reduce(
    (sum, c) => ({
      series: sum.series + c.series,
      active: sum.active + c.active,
      paused: sum.paused + c.paused,
      due: sum.due + c.due,
      overdue: sum.overdue + c.overdue,
      upcoming: sum.upcoming + c.upcoming,
      pairs: sum.pairs + c.pairs,
      ambiguous: sum.ambiguous + c.ambiguous,
      truncated: sum.truncated || c.truncated,
    }),
    { series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 0, truncated: false },
  )
}
