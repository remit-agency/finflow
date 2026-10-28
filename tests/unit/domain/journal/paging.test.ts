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
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    expect(s.moreLoading).toBe(true)
    s = pagingReducer(s, { type: 'more', key: 'k', after: 'c1', page: { rows: [row('b')], next: null } })
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
  it('ignores a «more» fetched with a cursor the list has moved past (a reload replaced the rows)', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    s = pagingReducer(s, { type: 'replace', key: 'k', rows: [row('a'), row('b')], next: 'c2' })
    expect(s).toMatchObject({ moreLoading: false, next: 'c2' })
    const stale = pagingReducer(s, { type: 'more', key: 'k', after: 'c1', page: { rows: [row('x')], next: 'c9' } })
    expect(stale).toBe(s)
    expect(stale.rows.map((r) => r.tx.id)).toEqual(['a', 'b'])
  })
  it('a stale «more» does not clear the flag of a newer request in flight', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    s = pagingReducer(s, { type: 'replace', key: 'k', rows: [row('a'), row('b')], next: 'c2' })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c2' })
    s = pagingReducer(s, { type: 'more', key: 'k', after: 'c1', page: { rows: [row('x')], next: null } })
    expect(s.moreLoading).toBe(true)
    s = pagingReducer(s, { type: 'more', key: 'k', after: 'c2', page: { rows: [row('c')], next: null } })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['a', 'b', 'c'])
    expect(s.moreLoading).toBe(false)
  })
  it('a failed «load more» keeps the rows and the list ready, flags a retry, and starting again clears the flag', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    s = pagingReducer(s, { type: 'failMore', key: 'k', after: 'c1' })
    expect(s).toMatchObject({ phase: 'ready', moreLoading: false, moreError: true, next: 'c1' })
    expect(s.rows).toHaveLength(1)
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    expect(s).toMatchObject({ moreLoading: true, moreError: false })
    s = pagingReducer(s, { type: 'more', key: 'k', after: 'c1', page: { rows: [row('b')], next: null } })
    expect(s.rows.map((r) => r.tx.id)).toEqual(['a', 'b'])
  })
  it('a stale failure of «load more» is ignored', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    s = pagingReducer(s, { type: 'replace', key: 'k', rows: [row('a')], next: 'c1' })
    expect(pagingReducer(s, { type: 'failMore', key: 'k', after: 'c1' })).toBe(s)
  })
  it('a reload clears an earlier «more» error', () => {
    let s = pagingReducer(initialPaging('k'), { type: 'first', key: 'k', page: { rows: [row('a')], next: 'c1' } })
    s = pagingReducer(s, { type: 'moreStart', key: 'k', after: 'c1' })
    s = pagingReducer(s, { type: 'failMore', key: 'k', after: 'c1' })
    expect(pagingReducer(s, { type: 'replace', key: 'k', rows: [row('a')], next: 'c1' }).moreError).toBe(false)
  })
})
