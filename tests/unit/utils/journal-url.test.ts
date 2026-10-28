import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS } from '@/lib/domain/journal/filter'
import { DEFAULT_JOURNAL_PERIOD, viewFromParams, viewToParams } from '@/lib/utils/journal-url'

const NOW = new Date('2026-10-28T12:00:00Z')

describe('journal url', () => {
  it('an empty query is all time with no filters', () => {
    expect(viewFromParams(new URLSearchParams(), NOW)).toEqual({ filters: EMPTY_FILTERS, period: DEFAULT_JOURNAL_PERIOD })
  })
  it('a preset is resolved against today and is not written as dates', () => {
    const view = viewFromParams(new URLSearchParams('period=currentMonth'), NOW)
    expect(view.period).toEqual({ preset: 'currentMonth' })
    expect(view.filters).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(viewToParams(view).toString()).toBe('period=currentMonth')
  })
  it('a custom range keeps its days in the url', () => {
    const view = viewFromParams(new URLSearchParams('period=custom&from=2026-03-01&to=2026-03-15&q=zus'), NOW)
    expect(view.period.preset).toBe('custom')
    expect(view.filters).toMatchObject({ from: '2026-03-01', to: '2026-03-15', q: 'zus' })
    const out = viewToParams(view)
    expect(out.get('period')).toBe('custom')
    expect(out.get('from')).toBe('2026-03-01')
    expect(out.get('q')).toBe('zus')
  })
  it('a custom period without both days falls back to all time', () => {
    expect(viewFromParams(new URLSearchParams('period=custom&from=2026-03-01'), NOW).period).toEqual(DEFAULT_JOURNAL_PERIOD)
  })
  it('the selected account lives in the shell, not in the url', () => {
    const view = viewFromParams(new URLSearchParams('account=a1'), NOW)
    expect(view.filters.accountId).toBeUndefined()
    expect(viewToParams({ ...view, filters: { ...view.filters, accountId: 'a1' } }).has('account')).toBe(false)
  })
  it('round-trips the other filters', () => {
    const p = new URLSearchParams('types=income&status=planned&min=100&cp=c1&basis=accrual&period=prevYear')
    expect(viewToParams(viewFromParams(p, NOW)).toString()).toBe('basis=accrual&min=100&cp=c1&types=income&status=planned&period=prevYear')
  })
})
