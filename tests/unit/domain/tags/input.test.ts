import { describe, expect, it } from 'vitest'
import { TagError } from '@/lib/domain/tags/errors'
import { cleanTagName, parseRecalcRequest, parseTagInput, parseTagPatch } from '@/lib/domain/tags/input'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof TagError ? `${e.code}:${e.field}` : 'other'
  }
  return 'none'
}

describe('parseTagInput', () => {
  it('fills the colour and the flag', () => {
    expect(parseTagInput({ name: '  ПДВ  ' })).toEqual({ name: 'ПДВ', color: 'slate', excludeFromAnalytics: false })
  })

  it('keeps a palette colour and the flag, and collapses inner spaces', () => {
    expect(parseTagInput({ name: 'Bankomat   kasa', color: 'amber', excludeFromAnalytics: true })).toEqual({
      name: 'Bankomat kasa',
      color: 'amber',
      excludeFromAnalytics: true,
    })
  })

  it('accepts a name of exactly 50 characters', () => {
    expect(parseTagInput({ name: 'x'.repeat(50) }).name).toHaveLength(50)
  })

  it.each([
    ['a non-object body', 'x', 'invalid_input:body'],
    ['an unknown key', { name: 'a', archived: true }, 'invalid_input:archived'],
    ['no name', {}, 'invalid_input:name'],
    ['an empty name', { name: '   ' }, 'invalid_input:name'],
    ['a name of 51 characters', { name: 'x'.repeat(51) }, 'invalid_input:name'],
    ['a name without a letter or digit', { name: '!!!' }, 'invalid_input:name'],
    ['a colour outside the palette', { name: 'a', color: '#ff0000' }, 'invalid_input:color'],
    ['a flag that is not a boolean', { name: 'a', excludeFromAnalytics: 'yes' }, 'invalid_input:excludeFromAnalytics'],
  ])('refuses %s', (_label, body, expected) => {
    expect(code(() => parseTagInput(body))).toBe(expected)
  })
})

describe('parseTagPatch', () => {
  it('takes only what is given', () => {
    expect(parseTagPatch({ archived: true })).toEqual({ archived: true })
    expect(parseTagPatch({ name: ' VAT ', color: 'rose', excludeFromAnalytics: false })).toEqual({ name: 'VAT', color: 'rose', excludeFromAnalytics: false })
  })

  it.each([
    ['an empty patch', {}, 'invalid_input:body'],
    ['recalcPending from a client', { recalcPending: false }, 'invalid_input:recalcPending'],
    ['an archived flag that is not a boolean', { archived: 1 }, 'invalid_input:archived'],
    ['an empty name', { name: '' }, 'invalid_input:name'],
  ])('refuses %s', (_label, body, expected) => {
    expect(code(() => parseTagPatch(body))).toBe(expected)
  })
})

describe('parseRecalcRequest', () => {
  it('a first step has no cursor, a next one names the last operation it read', () => {
    expect(parseRecalcRequest({})).toEqual({ cursor: null })
    expect(parseRecalcRequest({ cursor: 'tx-123' })).toEqual({ cursor: 'tx-123' })
  })

  it('refuses a cursor that is not a document id and unknown keys', () => {
    expect(code(() => parseRecalcRequest({ cursor: 'a/b' }))).toBe('invalid_input:cursor')
    expect(code(() => parseRecalcRequest({ step: 1 }))).toBe('invalid_input:step')
  })
})

describe('cleanTagName', () => {
  it('is the cleaning both parsers use', () => {
    expect(cleanTagName(' a   b ')).toBe('a b')
  })
})
