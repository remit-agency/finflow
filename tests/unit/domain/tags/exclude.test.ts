import { describe, expect, it } from 'vitest'
import { excludedFromTags, tagFlagsOf, type TagFlags } from '@/lib/domain/tags/exclude'

const flags = new Map<string, TagFlags>([
  ['vat', { excludeFromAnalytics: true }],
  ['q4', { excludeFromAnalytics: false }],
])

describe('excludedFromTags', () => {
  it('is true when one of the tags has the flag', () => {
    expect(excludedFromTags(['q4', 'vat'], flags)).toBe(true)
  })

  it('is false without tags, with tags without the flag and with tags that do not exist', () => {
    expect(excludedFromTags([], flags)).toBe(false)
    expect(excludedFromTags(['q4'], flags)).toBe(false)
    expect(excludedFromTags(['ghost'], flags)).toBe(false)
  })
})

describe('tagFlagsOf', () => {
  it('reads the flag of the documents that exist; anything but true is false', () => {
    const docs = [
      { id: 'a', exists: true, get: (field: string) => (field === 'excludeFromAnalytics' ? true : undefined) },
      { id: 'b', exists: false, get: () => undefined },
      { id: 'c', exists: true, get: () => 'yes' },
    ]
    expect(tagFlagsOf(docs)).toEqual(
      new Map([
        ['a', { excludeFromAnalytics: true }],
        ['c', { excludeFromAnalytics: false }],
      ]),
    )
  })
})
