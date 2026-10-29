import { describe, expect, it } from 'vitest'
import { mergeTags, sameTags, tagIdsOf } from '@/lib/domain/tags/assign'

describe('tagIdsOf', () => {
  it('reads a list of ids, an empty list included', () => {
    expect(tagIdsOf(['a', 'b'], 10)).toEqual(['a', 'b'])
    expect(tagIdsOf([], 10)).toEqual([])
  })

  it.each([
    ['not an array', 'a'],
    ['too many', ['a', 'b', 'c']],
    ['a repeat', ['a', 'a']],
    ['a path', ['a/b']],
    ['a reserved id', ['__x__']],
    ['a number', [1]],
  ])('is null for %s', (_label, value) => {
    expect(tagIdsOf(value, 2)).toBeNull()
  })
})

describe('mergeTags', () => {
  it('adds what is missing after what is there, in order', () => {
    expect(mergeTags(['a'], ['b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('takes off first, then adds', () => {
    expect(mergeTags(['a', 'b'], ['c'], ['a'])).toEqual(['b', 'c'])
  })

  it('stops at the limit and never drops what is there', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`)
    expect(mergeTags(ten, ['x'])).toEqual(ten)
    expect(mergeTags(ten.slice(0, 9), ['x', 'y'])).toEqual([...ten.slice(0, 9), 'x'])
    expect(mergeTags(['a', 'b', 'c'], ['d'], [], 3)).toEqual(['a', 'b', 'c'])
  })
})

describe('sameTags', () => {
  it('is the same ids in the same order', () => {
    expect(sameTags(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameTags(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameTags([], ['a'])).toBe(false)
  })
})
