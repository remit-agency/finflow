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
  | { type: 'first'; key: string; page: JournalPage }
  | { type: 'moreStart'; key: string }
  | { type: 'more'; key: string; page: JournalPage }
  | { type: 'replace'; key: string; rows: JournalRow[]; next: string | null }
  | { type: 'fail'; key: string }

export const initialPaging = (key: string): PagingState => ({ key, rows: [], next: null, phase: 'loading', moreLoading: false })

export function pagingReducer(state: PagingState, action: PagingAction): PagingState {
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
