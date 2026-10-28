import { describe, expect, it } from 'vitest'
import { initialPaging, pagingReducer } from '@/lib/domain/journal/paging'
import type { JournalRow } from '@/lib/domain/journal/types'

const row = (id: string): JournalRow => ({
  tx: { id, type: 'expense', status: 'actual', accountId: 'a', amountMinor: 1, currency: 'PLN', paymentDate: '2026-10-01', accrual: { mode: 'date', date: '2026-10-01' }, isRecurring: false, tags: [], fileUrls: [] },
  balanceAfterMinor: 0,
})

describe('pagingReducer', () => {
  it('starts loading', () => {
    expect(initialPaging('k').phase).toBe('loading')
  })
  it('the first page makes the list ready', () => {
    const s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    expect(s).toMatchObject({ phase: 'ready', next: 'c1', moreLoading: false })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['a'])
  })
  it('more pages append, and loading more is flagged', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k' })
    expect(s.moreLoading).toBe(true)
    s = pagingReducer(s, { type: 'more', key: 'k', page: { rows: [row('b')], next: null } })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['a', 'b'])
    expect(s).toMatchObject({ next: null, moreLoading: false })
  })
  it('ignores an answer for another key (the filters changed meanwhile)', () => {
    const s = initialPaging('new')
    expect(pagingReducer(s, { type: 'first', key: 'old', page: { rows: [row('x')], next: null } })).toBe(s)
  })
  it('a new key starts a fresh load and then accepts its own answers', () => {
    let s = pagingReducer(initialPaging('old'), { type: 'first', key: 'old', page: { rows: [row('x')], next: 'c' } })
    s = pagingReducer(s, { type: 'begin', key: 'new' })
    expect(s).toMatchObject({ key: 'new', phase: 'loading', next: null })
    expect(s.rows).toHaveLength(0)
    expect(pagingReducer(s, { type: 'first', key: 'old', page: { rows: [row('x')], next: null } })).toBe(s)
    s = pagingReducer(s, { type: 'first', key: 'new', page: { rows: [row('y')], next: null } })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['y'])
    expect(pagingReducer(s, { type: 'begin', key: 'new' })).toBe(s)
  })
  it('replace swaps the rows in place (a reload after a change)', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a'), row('b')], next: 'c' } })
    s = pagingReducer(s, { type: 'replace', key: 'k', rows: [row('b')], next: null })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['b'])
    expect(s.next).toBeNull()
  })
  it('a failure keeps the rows that were shown', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c' } })
    s = pagingReducer(s, { type: 'fail', key: 'k' })
    expect(s).toMatchObject({ phase: 'error', moreLoading: false })
    expect(s.rows).toHaveLength(1)
  })
})
