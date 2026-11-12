import { describe, expect, it } from 'vitest'
import { upcomingBlock, upcomingEnd } from '@/lib/domain/recurring/overview'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const plan = (id: string, paymentDate: string, accountId = 'a1'): PlannedRow => ({
  id,
  type: 'expense',
  accountId,
  amountMinor: 1000,
  currency: 'PLN',
  paymentDate,
  estimated: false,
  manual: false,
})

describe('upcomingEnd: the last day of a block period', () => {
  it('is a month, six months or no end', () => {
    expect(upcomingEnd('month', '2026-11-11')).toBe('2026-12-11')
    expect(upcomingEnd('half', '2026-11-11')).toBe('2027-05-11')
    expect(upcomingEnd('all', '2026-11-11')).toBeNull()
  })

  it('a month the target does not have ends on its last day', () => {
    expect(upcomingEnd('month', '2026-01-31')).toBe('2026-02-28')
    expect(upcomingEnd('half', '2026-08-31')).toBe('2027-02-28')
  })
})

describe('upcomingBlock: the rows of the journal «Майбутні платежі» block', () => {
  it('is the overdue ones, then the upcoming ones, and the server\'s counts', () => {
    const block = upcomingBlock({
      overdue: [plan('o1', '2026-11-01'), plan('o2', '2026-11-05')],
      overdueCount: 2,
      upcoming: [plan('u0', '2026-11-11'), plan('u6', '2026-11-17')],
      upcomingCount: 2,
    })
    expect(block.rows.map((r) => r.id)).toEqual(['o1', 'o2', 'u0', 'u6'])
    expect(block).toMatchObject({ count: 4, exact: true })
  })

  it('is empty when nothing is planned', () => {
    expect(upcomingBlock({ overdue: [], overdueCount: 0, upcoming: [], upcomingCount: 0 })).toEqual({ rows: [], count: 0, exact: true })
  })

  it('counts every operation even when the server listed only the first rows', () => {
    const block = upcomingBlock({ overdue: [plan('o1', '2026-10-01')], overdueCount: 160, upcoming: [plan('u1', '2026-11-12')], upcomingCount: 340 })
    expect(block.rows).toHaveLength(2)
    expect(block).toMatchObject({ count: 500, exact: true })
  })

  it('follows the account chosen in the sidebar: its rows only, counted as listed', () => {
    const read = {
      overdue: [plan('o1', '2026-11-01', 'a1'), plan('o2', '2026-11-02', 'a2')],
      overdueCount: 2,
      upcoming: [plan('u1', '2026-11-12', 'a2'), plan('u2', '2026-11-13', 'a1')],
      upcomingCount: 2,
    }
    expect(upcomingBlock(read, 'a2')).toMatchObject({ rows: [{ id: 'o2' }, { id: 'u1' }], count: 2, exact: true })
  })

  it('is not exact for an account when the server listed fewer rows than it counted', () => {
    const block = upcomingBlock({ overdue: [], overdueCount: 0, upcoming: [plan('u1', '2026-11-12', 'a2')], upcomingCount: 300 }, 'a2')
    expect(block).toMatchObject({ count: 1, exact: false })
  })
})
