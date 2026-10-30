import { describe, expect, it } from 'vitest'
import { freeTextTagged } from '@/scripts/lib/check-tags'

describe('freeTextTagged', () => {
  const tagIds = new Set(['vat', 'q4'])

  it('passes operations without tags or with the ids of the company tags', () => {
    expect(freeTextTagged([{ id: 'a', tags: [] }, { id: 'b', tags: undefined }, { id: 'c', tags: ['vat', 'q4'] }], tagIds)).toEqual([])
  })

  it('lists free text from before S10t, entries that are not strings and a tags field that is not a list', () => {
    expect(
      freeTextTagged(
        [
          { id: 'a', tags: ['Q4 2026'] },
          { id: 'b', tags: ['vat', 'ghost'] },
          { id: 'c', tags: [1] },
          { id: 'd', tags: 'vat' },
          { id: 'e', tags: ['vat'] },
        ],
        tagIds,
      ),
    ).toEqual(['a', 'b', 'c', 'd'])
  })
})
