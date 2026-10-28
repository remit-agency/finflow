import { isDay } from '@/lib/domain/ledger/days'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import type { Accrual } from '@/lib/domain/ledger/types'

/** The «transaction date is different» part of the form: when the operation counts for the P&L. */
export interface AccrualState {
  /** The switch. Off: no own accrual, the server makes it follow the payment date. */
  on: boolean
  mode: 'date' | 'period'
  /** The single accrual date; null while it still follows the payment date. */
  date: string | null
  from: string
  to: string
}

export type AccrualError = 'accrualDate' | 'accrualFrom' | 'accrualTo' | 'accrualOrder'

export function emptyAccrual(paymentDate: string): AccrualState {
  return { on: false, mode: 'date', date: null, from: paymentDate, to: paymentDate }
}

const valid = (day: string): boolean => isDay(day) && day >= MIN_DAY

export function accrualFor(state: AccrualState, paymentDate: string): Accrual | undefined {
  if (!state.on) return undefined
  if (state.mode === 'date') return { mode: 'date', date: state.date ?? paymentDate }
  return { mode: 'period', from: state.from, to: state.to }
}

export function accrualError(state: AccrualState, paymentDate: string): AccrualError | null {
  if (!state.on) return null
  if (state.mode === 'date') return valid(state.date ?? paymentDate) ? null : 'accrualDate'
  if (!valid(state.from)) return 'accrualFrom'
  if (!valid(state.to)) return 'accrualTo'
  return state.from <= state.to ? null : 'accrualOrder'
}

/** The form state of a stored accrual. A date equal to the payment date is the same as having none. */
export function accrualStateOf(accrual: Accrual, paymentDate: string): AccrualState {
  if (accrual.mode === 'period') return { on: true, mode: 'period', date: null, from: accrual.from, to: accrual.to }
  if (accrual.date === paymentDate) return emptyAccrual(paymentDate)
  return { on: true, mode: 'date', date: accrual.date, from: paymentDate, to: paymentDate }
}
