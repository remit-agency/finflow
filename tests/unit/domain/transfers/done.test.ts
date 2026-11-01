import { describe, expect, it } from 'vitest'
import { withoutDone } from '@/lib/domain/transfers/done'
import type { SuggestionSide, TransferOutcome, TransferSuggestion } from '@/lib/domain/transfers/types'

const side = (id: string): SuggestionSide => ({ id, version: `v-${id}`, accountId: 'mil', amountMinor: 1_000, currency: 'PLN', paymentDate: '2026-10-20' })
const pair = (from: string, to: string): TransferSuggestion => ({ from: side(from), to: side(to) })
const made = (from: string, to: string): TransferOutcome => ({ ids: [from, to], ok: true, id: from, deletedId: to, droppedTags: 0, before: [] })
const failed = (from: string, to: string): TransferOutcome => ({ ids: [from, to], ok: false, code: 'conflict' })

describe('withoutDone', () => {
  it('drops the pairs that went through and keeps the others in their order', () => {
    const pairs = [pair('a', 'b'), pair('c', 'd'), pair('e', 'f')]
    const left = withoutDone(pairs, [made('a', 'b'), failed('c', 'd'), made('e', 'f')])
    expect(left).toEqual([pair('c', 'd')])
  })

  it('keeps a pair whose confirmation failed, with the same object', () => {
    const pairs = [pair('a', 'b'), pair('c', 'd')]
    const left = withoutDone(pairs, [failed('a', 'b')])
    expect(left).toEqual(pairs)
    expect(left[0]).toBe(pairs[0])
  })

  it('matches by the ordered ids: the reversed pair is another pair', () => {
    expect(withoutDone([pair('a', 'b')], [made('b', 'a')])).toEqual([pair('a', 'b')])
  })

  it('ignores outcomes of pairs that are not listed and returns the list unchanged when nothing went through', () => {
    const pairs = [pair('a', 'b')]
    expect(withoutDone(pairs, [made('x', 'y')])).toEqual(pairs)
    expect(withoutDone(pairs, [])).toEqual(pairs)
  })

  it('does not change the list it is given', () => {
    const pairs = [pair('a', 'b'), pair('c', 'd')]
    withoutDone(pairs, [made('a', 'b')])
    expect(pairs).toHaveLength(2)
  })
})
