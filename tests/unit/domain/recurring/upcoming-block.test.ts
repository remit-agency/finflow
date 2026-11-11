import { describe, expect, it } from 'vitest'
import { upcomingBlock } from '@/lib/domain/recurring/overview'
import type { PlannedRow } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-11'

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

describe('upcomingBlock: the rows of the journal «Майбутні платежі» block', () => {
  it('is the overdue ones, then the next 7 days (today included, the 8th day not)', () => {
    const block = upcomingBlock(
      {
        overdue: [plan('o1', '2026-11-01'), plan('o2', '2026-11-05')],
        overdueCount: 2,
        upcoming: [plan('u0', '2026-11-11'), plan('u6', '2026-11-17'), plan('u7', '2026-11-18'), plan('u20', '2026-12-01')],
      },
      TODAY,
    )
    expect(block.rows.map((r) => r.id)).toEqual(['o1', 'o2', 'u0', 'u6'])
    expect(block.count).toBe(4)
  })

  it('is empty when nothing is overdue or near', () => {
    expect(upcomingBlock({ overdue: [], overdueCount: 0, upcoming: [plan('far', '2026-12-30')] }, TODAY)).toEqual({ rows: [], count: 0 })
  })

  it('counts every overdue operation even when the overview listed only some of them', () => {
    const block = upcomingBlock({ overdue: [plan('o1', '2026-10-01')], overdueCount: 60, upcoming: [plan('u1', '2026-11-12')] }, TODAY)
    expect(block.rows).toHaveLength(2)
    expect(block.count).toBe(61)
  })

  it('follows the account selected in the sidebar: only its rows, and only the overdue ones that were listed', () => {
    const block = upcomingBlock(
      {
        overdue: [plan('o1', '2026-11-01', 'a1'), plan('o2', '2026-11-02', 'a2')],
        overdueCount: 60,
        upcoming: [plan('u1', '2026-11-12', 'a2'), plan('u2', '2026-11-13', 'a1')],
      },
      TODAY,
      'a2',
    )
    expect(block.rows.map((r) => r.id)).toEqual(['o2', 'u1'])
    expect(block.count).toBe(2)
  })
})
