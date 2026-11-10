import { describe, expect, it } from 'vitest'
import { recurringCheckLine, sumRecurringChecks, type RecurringCheck } from '@/scripts/lib/check-recurring'

const a: RecurringCheck = { series: 3, active: 2, paused: 1, due: 1, overdue: 4, upcoming: 6, pairs: 1, ambiguous: 0, truncated: false }
const b: RecurringCheck = { series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 2, truncated: true }

describe('check:recurring', () => {
  it('prints counts only, one line per company', () => {
    expect(recurringCheckLine('org1', a)).toBe('org org1: 3 series (2 active, 1 paused, 1 due), 4 overdue plan(s), 6 plan(s) in the next 31 days, 1 pair(s) to suggest, 0 ambiguous side(s)')
    expect(recurringCheckLine('org2', b)).toBe('org org2: 0 series (0 active, 0 paused, 0 due), 0 overdue plan(s), 0 plan(s) in the next 31 days, 0 pair(s) to suggest, 2 ambiguous side(s) (cut at a read limit)')
  })

  it('adds the companies up', () => {
    expect(sumRecurringChecks([a, b])).toEqual({ series: 3, active: 2, paused: 1, due: 1, overdue: 4, upcoming: 6, pairs: 1, ambiguous: 2, truncated: true })
    expect(sumRecurringChecks([])).toEqual({ series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 0, truncated: false })
  })
})
