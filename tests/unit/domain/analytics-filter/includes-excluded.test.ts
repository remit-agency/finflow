import { describe, expect, it } from 'vitest'
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, includesExcluded } from '@/lib/domain/analytics-filter/filter'
import { NO_TAG } from '@/lib/domain/journal/filter'

describe('includesExcluded', () => {
  it('a concrete tag brings the operations excluded from analytics in; «без тегів» alone does not', () => {
    expect(includesExcluded({ ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] })).toBe(true)
    expect(includesExcluded({ ...EMPTY_ANALYTICS_FILTERS, tagIds: [NO_TAG] })).toBe(false)
    expect(includesExcluded({ ...EMPTY_ANALYTICS_FILTERS, tagIds: [NO_TAG, 'vat'] })).toBe(true)
    expect(includesExcluded(EMPTY_ANALYTICS_FILTERS)).toBe(false)
  })

  it('is the rule filterForAnalytics answers with', () => {
    expect(filterForAnalytics([], { ...EMPTY_ANALYTICS_FILTERS, tagIds: ['vat'] }, undefined).includeExcluded).toBe(true)
    expect(filterForAnalytics([], { ...EMPTY_ANALYTICS_FILTERS, tagIds: [NO_TAG] }, undefined).includeExcluded).toBe(false)
  })
})
