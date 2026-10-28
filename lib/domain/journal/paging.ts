import type { JournalPage, JournalRow } from './types'

export interface PagingState {
  /** The orgId and filters these rows belong to; an answer for another key is stale and ignored. */
  key: string
  rows: JournalRow[]
  next: string | null
  phase: 'loading' | 'ready' | 'error'
  moreLoading: boolean
  /** The cursor the in-flight «load more» was fetched with; a reload clears it so that answer is ignored. */
  moreAfter: string | null
  /** The last «load more» failed: the rows stay, and it can be asked again. */
  moreError: boolean
}

export type PagingAction =
  | { type: 'begin'; key: string }
  | { type: 'first'; key: string; page: JournalPage }
  | { type: 'moreStart'; key: string; after: string }
  | { type: 'more'; key: string; after: string; page: JournalPage }
  | { type: 'failMore'; key: string; after: string }
  | { type: 'replace'; key: string; rows: JournalRow[]; next: string | null }
  | { type: 'fail'; key: string }

export const initialPaging = (key: string): PagingState => ({
  key,
  rows: [],
  next: null,
  phase: 'loading',
  moreLoading: false,
  moreAfter: null,
  moreError: false,
})

export function pagingReducer(state: PagingState, action: PagingAction): PagingState {
  // A new key (other filters or company) starts a fresh load; every other answer for a key that is not the
  // current one is stale and ignored.
  if (action.type === 'begin') return action.key === state.key ? state : initialPaging(action.key)
  if (action.key !== state.key) return state
  switch (action.type) {
    case 'first':
      return { ...initialPaging(state.key), rows: action.page.rows, next: action.page.next, phase: 'ready' }
    case 'moreStart':
      return { ...state, moreLoading: true, moreAfter: action.after, moreError: false }
    case 'more':
      // A page fetched after a cursor the list has moved past (a reload replaced the rows meanwhile) would be
      // appended in the wrong place: drop it. `moreAfter` is left alone, it may belong to a newer request.
      if (action.after !== state.next || action.after !== state.moreAfter) return state
      return { ...state, rows: [...state.rows, ...action.page.rows], next: action.page.next, moreLoading: false, moreAfter: null }
    case 'failMore':
      if (action.after !== state.moreAfter) return state
      return { ...state, phase: 'ready', moreLoading: false, moreAfter: null, moreError: true }
    case 'replace':
      return { ...state, rows: action.rows, next: action.next, phase: 'ready', moreLoading: false, moreAfter: null, moreError: false }
    case 'fail':
      return { ...state, phase: 'error', moreLoading: false, moreAfter: null }
  }
}
