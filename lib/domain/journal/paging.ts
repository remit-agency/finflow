import type { JournalPage, JournalRow } from './types'

export interface PagingState {
  /** The orgId and filters these rows belong to; an answer for another key is stale and ignored. */
  key: string
  rows: JournalRow[]
  next: string | null
  phase: 'loading' | 'ready' | 'error'
  moreLoading: boolean
}

export type PagingAction =
  | { type: 'begin'; key: string }
  | { type: 'first'; key: string; page: JournalPage }
  | { type: 'moreStart'; key: string }
  | { type: 'more'; key: string; page: JournalPage }
  | { type: 'replace'; key: string; rows: JournalRow[]; next: string | null }
  | { type: 'fail'; key: string }

export const initialPaging = (key: string): PagingState => ({ key, rows: [], next: null, phase: 'loading', moreLoading: false })

export function pagingReducer(state: PagingState, action: PagingAction): PagingState {
  // A new key (other filters or company) starts a fresh load; every other answer for a key that is not the
  // current one is stale and ignored.
  if (action.type === 'begin') return action.key === state.key ? state : initialPaging(action.key)
  if (action.key !== state.key) return state
  switch (action.type) {
    case 'first':
      return { key: state.key, rows: action.page.rows, next: action.page.next, phase: 'ready', moreLoading: false }
    case 'moreStart':
      return { ...state, moreLoading: true }
    case 'more':
      return { ...state, rows: [...state.rows, ...action.page.rows], next: action.page.next, moreLoading: false }
    case 'replace':
      return { ...state, rows: action.rows, next: action.next, phase: 'ready', moreLoading: false }
    case 'fail':
      return { ...state, phase: 'error', moreLoading: false }
  }
}
