import { describe, expect, it } from 'vitest'
import { parseTag, tagToDoc, TAG_SCHEMA_VERSION } from '@/lib/domain/tags/doc'
import { tagNameKey } from '@/lib/domain/tags/keys'
import type { Tag } from '@/lib/domain/tags/types'

const tag: Tag = { id: 'tg1', name: 'ПДВ', color: 'rose', excludeFromAnalytics: true, archived: false, recalcPending: false }

describe('tag documents', () => {
  it('round-trip', () => {
    expect(tagToDoc(tag)).toEqual({ schemaVersion: TAG_SCHEMA_VERSION, name: 'ПДВ', color: 'rose', excludeFromAnalytics: true, archived: false, recalcPending: false })
    expect(parseTag('tg1', tagToDoc(tag))).toEqual(tag)
  })

  it('an unknown colour reads as slate, a missing recalcPending as false', () => {
    const { recalcPending: _pending, ...rest } = tagToDoc(tag)
    void _pending
    expect(parseTag('tg1', { ...rest, color: 'pink' })).toEqual({ ...tag, color: 'slate', recalcPending: false })
  })

  it.each([
    ['another schema', { ...tagToDoc(tag), schemaVersion: 2 }],
    ['no name', { ...tagToDoc(tag), name: '' }],
    ['a flag that is not a boolean', { ...tagToDoc(tag), excludeFromAnalytics: 'true' }],
    ['an archived that is not a boolean', { ...tagToDoc(tag), archived: null }],
    ['not an object', 'tag'],
  ])('is null for %s', (_label, data) => {
    expect(parseTag('tg1', data)).toBeNull()
  })
})

describe('tagNameKey', () => {
  it('is the counterparty name key: case and Latin diacritics do not count, Cyrillic stays', () => {
    expect(tagNameKey('Łódź  VAT')).toBe('name_lodz_vat')
    expect(tagNameKey('ПДВ')).toBe(tagNameKey('пдв'))
    expect(tagNameKey('ПДВ')).toBe('name_пдв')
  })
})
