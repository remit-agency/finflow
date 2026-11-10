import { describe, expect, it } from 'vitest'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import { fillPlan, paymentFrom, parsePlanId, planId, planInputOf, rewriteOccurrences, rewriteState, seriesFieldsOf, takenFrom, takenPeriods } from '@/lib/domain/recurring/plan'
import type { Series } from '@/lib/domain/recurring/types'

const rent: Series = seriesFromInput(
  'ser1',
  parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-10-01', categoryId: 'rent', description: 'Lokal' }),
  'PLN',
)

describe('plan ids', () => {
  it('are pl_<series>_<occurrence> and read back', () => {
    expect(planId('ser1', '2026-11-10')).toBe('pl_ser1_2026-11-10')
    expect(parsePlanId('pl_ser1_2026-11-10')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-10' })
    expect(parsePlanId('pl_a_b_2026-11-10')).toEqual({ seriesId: 'a_b', occurrence: '2026-11-10' })
    for (const id of ['bk_x', 'pl_ser1_2026-11-31', 'pl__2026-11-10', 'pl_ser1']) expect(parsePlanId(id)).toBeNull()
  })
})

describe('fillPlan', () => {
  it('the first fill covers today to three months ahead and is due again tomorrow', () => {
    expect(fillPlan(rent, '2026-10-27')).toEqual({ occurrences: ['2026-11-10', '2026-12-10', '2027-01-10'], generatedThrough: '2027-01-27', dueOn: '2026-10-28' })
  })

  it('the first fill plans the occurrence whose payment day is today, though its nominal day has passed (C1)', () => {
    const zus: Series = { ...rent, dayOfMonth: 15, weekendRule: 'next', startDate: '2026-10-01' }
    expect(fillPlan(zus, '2026-11-16').occurrences[0]).toBe('2026-11-15')
    expect(fillPlan(zus, '2026-11-17').occurrences[0]).toBe('2026-12-15')
  })

  it('a later fill starts the day after the last one', () => {
    expect(fillPlan({ ...rent, generatedThrough: '2027-01-27' }, '2026-11-27')).toEqual({ occurrences: ['2027-02-10'], generatedThrough: '2027-02-27', dueOn: '2026-11-28' })
  })

  it('catches up the days the cron missed: the past ones become overdue plans', () => {
    expect(fillPlan({ ...rent, generatedThrough: '2027-01-27' }, '2027-04-01').occurrences).toEqual(['2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10', '2027-06-10'])
  })

  it('stops at the cap of one fill and stays due today', () => {
    const weekly: Series = { ...rent, frequency: 'weekly', dayOfMonth: null, weekday: 1, startDate: '2020-01-06', generatedThrough: '2020-01-05' }
    const plan = fillPlan(weekly, '2026-10-27', 5)
    expect(plan.occurrences).toEqual(['2020-01-06', '2020-01-13', '2020-01-20', '2020-01-27', '2020-02-03'])
    expect(plan).toMatchObject({ generatedThrough: '2020-02-03', dueOn: '2026-10-27' })
  })

  it('an ended series is no longer due; a paused one creates nothing', () => {
    expect(fillPlan({ ...rent, endDate: '2026-12-10' }, '2026-10-27')).toEqual({ occurrences: ['2026-11-10', '2026-12-10'], generatedThrough: '2027-01-27', dueOn: undefined })
    expect(fillPlan({ ...rent, status: 'paused', generatedThrough: '2027-01-27' }, '2026-11-27')).toEqual({ occurrences: [], generatedThrough: '2027-01-27', dueOn: undefined })
  })
})

describe('rewriting after a change', () => {
  it('takes the new schedule from today to the window end, except the periods already taken', () => {
    const moved: Series = { ...rent, dayOfMonth: 20 }
    expect(rewriteOccurrences(moved, '2026-10-27', new Set())).toEqual(['2026-11-20', '2026-12-20', '2027-01-20'])
    expect(rewriteOccurrences(moved, '2026-10-27', new Set(['2026-11']))).toEqual(['2026-12-20', '2027-01-20'])
  })

  it('keeps a weekend-shifted occurrence whose nominal day has passed while its payment day is still ahead (C1)', () => {
    // ZUS on the 15th, next business day: 2026-11-15 is a Sunday, so the payment falls on Monday 16 November.
    const zus: Series = { ...rent, dayOfMonth: 15, weekendRule: 'next', startDate: '2026-10-01', preset: 'zus' }
    expect(rewriteOccurrences(zus, '2026-11-16', new Set())).toContain('2026-11-15')
    expect(rewriteOccurrences(zus, '2026-11-17', new Set())).not.toContain('2026-11-15')
  })

  it('a skip made on the payment day of a Saturday occurrence still takes its period (C1 regression)', () => {
    // Every Saturday, paid on the next business day: Saturday 14 November is paid on Monday 16 November, and the person
    // skipped it that day. Its period (the week of 9 November) starts before the day of the change.
    const saturday: Series = { ...rent, frequency: 'weekly', dayOfMonth: null, weekday: 6, startDate: '2026-10-03', weekendRule: 'next' }
    expect(takenFrom(saturday, '2026-11-16')).toBe('2026-11-09')
    const taken = takenPeriods(saturday, '2026-11-16', ['2026-11-14'])
    expect(rewriteOccurrences(saturday, '2026-11-16', taken)).not.toContain('2026-11-14')
    expect(rewriteOccurrences(saturday, '2026-11-16', new Set())).toContain('2026-11-14')
  })

  it('a paid occurrence of the month before still takes its month when the change is the day after (C1 regression)', () => {
    // Day 31, next business day: Saturday 31 October is paid on Monday 2 November; a bank payment of 30 October matched it.
    const last: Series = { ...rent, dayOfMonth: 31, weekendRule: 'next', startDate: '2026-10-01' }
    expect(rewriteOccurrences(last, '2026-11-01', new Set())).toContain('2026-10-31')
    const taken = takenPeriods(last, '2026-11-01', ['2026-10-31'])
    expect(taken).toEqual(new Set(['2026-10']))
    expect(rewriteOccurrences(last, '2026-11-01', taken)).not.toContain('2026-10-31')
  })

  it('the bounds of a change: the period of the first day a plan can carry, and the payment day an operation of it can have', () => {
    const last: Series = { ...rent, dayOfMonth: 31, weekendRule: 'next', startDate: '2026-10-01' }
    expect(takenFrom(last, '2026-11-01')).toBe('2026-10-01')
    expect(paymentFrom(last, '2026-11-01')).toBe('2026-09-21')
  })

  it('a resumed or changed series is filled to the window end and due tomorrow until it ends', () => {
    expect(rewriteState(rent, '2026-10-27')).toEqual({ generatedThrough: '2027-01-27', dueOn: '2026-10-28' })
    expect(rewriteState({ ...rent, endDate: '2026-12-31' }, '2026-10-27')).toEqual({ generatedThrough: '2027-01-27', dueOn: undefined })
  })
})

describe('the planned operation of an occurrence', () => {
  it('is planned on the payment day, with only the usable references', () => {
    const zus: Series = { ...rent, weekendRule: 'next', dayOfMonth: 15, estimated: true, counterpartyId: 'system_zus', tags: ['t1', 't2'] }
    expect(planInputOf(zus, '2026-11-15', { categoryId: 'rent', tags: ['t1'] })).toEqual({
      clientId: 'pl_ser1_2026-11-15', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-11-16',
      accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: ['t1'], fileUrls: [], categoryId: 'rent', description: 'Lokal',
    })
    expect(seriesFieldsOf(zus, '2026-11-15')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(seriesFieldsOf(rent, '2026-11-10')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-10' })
  })
})
