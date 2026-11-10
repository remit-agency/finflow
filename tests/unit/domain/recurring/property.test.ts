import { describe, expect, it } from 'vitest'
import { addDays, daysApart, fromDay } from '@/lib/domain/ledger/days'
import { fillPlan, planId } from '@/lib/domain/recurring/plan'
import { occurrencesBetween, paymentDayOf, windowEnd } from '@/lib/domain/recurring/schedule'
import { MAX_SHIFT_DAYS, type Series } from '@/lib/domain/recurring/types'
import { isBusinessDay } from '@/lib/utils/pl-calendar'

/** A small seeded generator (mulberry32): the same seed gives the same run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(r: () => number, values: readonly T[]): T {
  return values[Math.floor(r() * values.length)]
}

function randomSeries(r: () => number, n: number): Series {
  const frequency = pick(r, ['weekly', 'monthly', 'everyNMonths', 'yearly'] as const)
  const startDate = addDays('2026-01-01', Math.floor(r() * 700))
  const series: Series = {
    id: `s${n}`, name: 'n', kind: 'expense', accountId: 'acc', tags: [], amountMinor: 100, currency: 'PLN', estimated: false, status: 'active',
    frequency,
    interval: frequency === 'everyNMonths' ? 1 + Math.floor(r() * 24) : 1,
    dayOfMonth: frequency === 'weekly' ? null : 1 + Math.floor(r() * 31),
    weekday: frequency === 'weekly' ? 1 + Math.floor(r() * 7) : null,
    startDate,
    weekendRule: pick(r, ['none', 'next', 'previous'] as const),
  }
  if (r() < 0.3) series.endDate = addDays(startDate, Math.floor(r() * 500))
  return series
}

describe('the daily fill over random series and days (property)', () => {
  it('creates every occurrence of the window exactly once, whatever days the cron misses or repeats', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed)
      const first = randomSeries(r, seed)
      let series = first
      let today = addDays('2026-01-01', Math.floor(r() * 700))
      const days = 30 + Math.floor(r() * 150)
      const returned: string[] = []
      let firstFill: string | null = null
      let lastFill: string | null = null
      for (let d = 0; d < days; d++, today = addDays(today, 1)) {
        if (r() < 0.25) continue // the hourly call did not come that day
        const runs = r() < 0.3 ? 2 : 1 // or came twice: the due guard keeps the second one from doing anything
        for (let run = 0; run < runs; run++) {
          if (series.dueOn !== undefined && series.dueOn > today) continue
          if (firstFill !== null && series.dueOn === undefined) continue // ended
          const plan = fillPlan(series, today)
          firstFill ??= today
          lastFill = today
          returned.push(...plan.occurrences)
          series = { ...series, generatedThrough: plan.generatedThrough, dueOn: plan.dueOn }
        }
      }
      const ids = returned.map((o) => planId(first.id, o))
      expect(new Set(ids).size, `seed ${seed}: an occurrence came twice`).toBe(ids.length)
      if (firstFill !== null && lastFill !== null) {
        expect(returned, `seed ${seed}`).toEqual(occurrencesBetween(first, firstFill, windowEnd(lastFill)))
      }
      for (const o of returned) {
        const pay = paymentDayOf(o, first.weekendRule)
        expect(daysApart(o, pay)).toBeLessThanOrEqual(MAX_SHIFT_DAYS)
        if (first.weekendRule !== 'none') expect(isBusinessDay(fromDay(pay)), `seed ${seed}: ${pay}`).toBe(true)
      }
    }
  })
})
