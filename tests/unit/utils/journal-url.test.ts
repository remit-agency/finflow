import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS } from '@/lib/domain/journal/filter'
import { DEFAULT_JOURNAL_FILTERS, DEFAULT_JOURNAL_PERIOD, journalFiltersActive, viewFromParams, viewToParams } from '@/lib/utils/journal-url'

const NOW = new Date('2026-10-28T12:00:00Z')

describe('journal url', () => {
  it('an empty query is all time, status «Факт» (what happened), no other filters', () => {
    expect(viewFromParams(new URLSearchParams(), NOW)).toEqual({ filters: DEFAULT_JOURNAL_FILTERS, period: DEFAULT_JOURNAL_PERIOD })
    expect(DEFAULT_JOURNAL_FILTERS).toEqual({ ...EMPTY_FILTERS, status: 'actual' })
  })
  it('the status of the address: nothing or unknown is «Факт», planned is planned, all is every status', () => {
    const status = (q: string) => viewFromParams(new URLSearchParams(q), NOW).filters.status
    expect(status('')).toBe('actual')
    expect(status('status=actual')).toBe('actual')
    expect(status('status=bogus')).toBe('actual')
    expect(status('status=planned')).toBe('planned')
    expect(status('status=all')).toBeUndefined()
  })
  it('«Факт» is not written to the address, «План» and every status are', () => {
    const base = viewFromParams(new URLSearchParams(), NOW)
    const out = (status: 'actual' | 'planned' | undefined) => viewToParams({ ...base, filters: { ...base.filters, status } }).toString()
    expect(out('actual')).toBe('')
    expect(out('planned')).toBe('status=planned')
    expect(out(undefined)).toBe('status=all')
    // and each one reads back as it was written
    for (const status of ['actual', 'planned', undefined] as const) {
      const view = { ...base, filters: { ...base.filters, status } }
      expect(viewFromParams(viewToParams(view), NOW).filters.status).toBe(status)
    }
  })
  it('the default status is not an active filter; any other status, or any other filter, is', () => {
    expect(journalFiltersActive(DEFAULT_JOURNAL_FILTERS)).toBe(false)
    expect(journalFiltersActive({ ...DEFAULT_JOURNAL_FILTERS, status: 'planned' })).toBe(true)
    expect(journalFiltersActive({ ...DEFAULT_JOURNAL_FILTERS, status: undefined })).toBe(true)
    expect(journalFiltersActive({ ...DEFAULT_JOURNAL_FILTERS, q: 'zus' })).toBe(true)
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

describe('journal url: a custom period picked in the menu', () => {
  // The shape PeriodSelect hands over: Dates (any time of the day), no filters.from/to.
  const picked = (start: Date, end: Date) => ({ filters: EMPTY_FILTERS, period: { preset: 'custom' as const, start, end } })

  it('writes the picked days into the address', () => {
    const out = viewToParams(picked(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-15T23:59:59.999Z')))
    expect(out.get('period')).toBe('custom')
    expect(out.get('from')).toBe('2026-03-01')
    expect(out.get('to')).toBe('2026-03-15')
  })
  it('puts the earlier day first when the two were picked the other way round', () => {
    const out = viewToParams(picked(new Date('2026-03-15T10:00:00Z'), new Date('2026-03-01T10:00:00Z')))
    expect(out.get('from')).toBe('2026-03-01')
    expect(out.get('to')).toBe('2026-03-15')
  })
  it('the written address reads back as the same range (filters and period)', () => {
    const view = viewFromParams(viewToParams(picked(new Date('2026-03-15T10:00:00Z'), new Date('2026-03-01T10:00:00Z'))), NOW)
    expect(view.filters).toMatchObject({ from: '2026-03-01', to: '2026-03-15' })
    expect(view.period.preset).toBe('custom')
  })
  it('the picked days win over stale filter dates', () => {
    const view = { filters: { ...EMPTY_FILTERS, from: '2020-01-01', to: '2020-12-31' }, period: { preset: 'custom' as const, start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-02T00:00:00Z') } }
    const out = viewToParams(view)
    expect(out.get('from')).toBe('2026-03-01')
    expect(out.get('to')).toBe('2026-03-02')
  })
})
