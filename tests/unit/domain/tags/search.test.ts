import { describe, expect, it } from 'vitest'
import { pickableTags, sortTags, tagByName } from '@/lib/domain/tags/search'
import type { Tag } from '@/lib/domain/tags/types'

const tag = (id: string, name: string, over: Partial<Tag> = {}): Tag => ({
  id,
  name,
  color: 'slate',
  excludeFromAnalytics: false,
  archived: false,
  recalcPending: false,
  ...over,
})

const TAGS = [
  tag('t3', 'Żywność'),
  tag('t1', 'bankomat'),
  tag('t2', 'ПДВ', { excludeFromAnalytics: true }),
  tag('t4', 'Stare', { archived: true }),
  tag('t5', 'Bank'),
]

describe('sortTags', () => {
  it('sorts by the comparable name, case and Latin diacritics ignored, then by id', () => {
    expect(sortTags(TAGS).map((t) => t.name)).toEqual(['Bank', 'bankomat', 'Stare', 'Żywność', 'ПДВ'])
    expect(sortTags([tag('b', 'X'), tag('a', 'x')]).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('pickableTags', () => {
  it('matches the typed text like the name key and leaves out the chosen and the archived ones', () => {
    expect(pickableTags(TAGS, 'BANK', []).map((t) => t.id)).toEqual(['t5', 't1'])
    expect(pickableTags(TAGS, 'zyw', []).map((t) => t.id)).toEqual(['t3'])
    expect(pickableTags(TAGS, '', ['t5', 't1']).map((t) => t.id)).toEqual(['t3', 't2'])
    expect(pickableTags(TAGS, 'star', [])).toEqual([])
  })

  it('offers archived tags when asked (taking a tag off)', () => {
    expect(pickableTags(TAGS, 'star', [], { includeArchived: true }).map((t) => t.id)).toEqual(['t4'])
  })

  it('puts the tag whose name is the typed text first, ahead of the names that only start with it', () => {
    const pool = [tag('in', 'Вхідний ПДВ'), tag('out', 'ПДВ', { excludeFromAnalytics: true })]
    expect(pickableTags(pool, 'ПДВ', []).map((t) => t.id)).toEqual(['out', 'in'])
    const vat = [tag('office', 'Office VAT'), tag('vat', 'VAT')]
    expect(pickableTags(vat, 'VAT', []).map((t) => t.id)).toEqual(['vat', 'office'])
  })

  it('ranks the exact name, then the prefixes, then the other matches; each group in name order', () => {
    const pool = [tag('urban', 'Urban'), tag('bankomat', 'Bankomat'), tag('bank', 'Bank'), tag('zeta', 'Zeta ba'), tag('alfa', 'Alfa ba')]
    expect(pickableTags(pool, 'ban', []).map((t) => t.id)).toEqual(['bank', 'bankomat', 'urban'])
    expect(pickableTags(pool, 'ba', []).map((t) => t.id)).toEqual(['bank', 'bankomat', 'alfa', 'urban', 'zeta'])
  })

  it('compares the exact name with case and diacritics ignored, like the name key', () => {
    const pool = [tag('prefix', 'Zolwik'), tag('exact', 'Żółw')]
    expect(pickableTags(pool, 'ZOLW', []).map((t) => t.id)).toEqual(['exact', 'prefix'])
  })

  it('leaves the rows in name order when nothing is typed', () => {
    expect(pickableTags(TAGS, '', []).map((t) => t.name)).toEqual(['Bank', 'bankomat', 'Żywność', 'ПДВ'])
  })
})

describe('tagByName', () => {
  it('finds the tag with the same name key, archived ones too', () => {
    expect(tagByName(TAGS, ' пдв ')?.id).toBe('t2')
    expect(tagByName(TAGS, 'STARE')?.id).toBe('t4')
    expect(tagByName(TAGS, 'Nowy')).toBeUndefined()
    expect(tagByName(TAGS, '!!!')).toBeUndefined()
  })
})
