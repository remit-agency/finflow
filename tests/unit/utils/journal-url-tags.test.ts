import { describe, expect, it } from 'vitest'
import { viewFromParams, viewToParams } from '@/lib/utils/journal-url'

describe('the tag filter in the address (S10t)', () => {
  it('travels with the rest of the view', () => {
    const view = viewFromParams(new URLSearchParams('tg=vat&ex=1&period=currentMonth'), new Date('2026-10-27T10:00:00Z'))
    expect(view.filters).toMatchObject({ tagIds: ['vat'], excludedOnly: true })
    expect(viewToParams(view).toString()).toBe('tg=vat&ex=1&period=currentMonth')
  })
})
