import { describe, expect, it } from 'vitest'
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsHref, analyticsPath } from '@/lib/shell/analytics-sections'

describe('ANALYTICS_SECTIONS', () => {
  it('lists the four reports in menu order', () => {
    expect(ANALYTICS_SECTIONS.map((s) => s.slug)).toEqual(['cashflow', 'pl', 'balance', 'calendar'])
  })
})

describe('analyticsPath', () => {
  it('builds the report URL with an encoded org id', () => {
    expect(analyticsPath('org1', 'pl')).toBe('/org1/analytics/pl')
    expect(analyticsPath('a b', 'calendar')).toBe('/a%20b/analytics/calendar')
  })
})

describe('analyticsHref', () => {
  it('carries the query of the report filters (S10f), nothing when there is none', () => {
    expect(analyticsHref('org1', 'pl', 'tg=vat&accounts=a1')).toBe('/org1/analytics/pl?tg=vat&accounts=a1')
    expect(analyticsHref('org1', 'balance', '')).toBe('/org1/analytics/balance')
  })
})

describe('activeAnalyticsSection', () => {
  it.each([
    ['/org1/analytics/cashflow', 'cashflow'],
    ['/org1/analytics/pl', 'pl'],
    ['/org1/analytics/balance/x', 'balance'],
    ['/org1/analytics/calendar', 'calendar'],
  ])('%s -> %s', (path, section) => {
    expect(activeAnalyticsSection(path, 'org1')).toBe(section)
  })

  it.each(['/org1/analytics', '/org1/analytics/unknown', '/org2/analytics/pl', '/org1/transactions'])('%s -> null', (path) => {
    expect(activeAnalyticsSection(path, 'org1')).toBeNull()
  })
})
