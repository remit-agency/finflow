import { isDay } from '@/lib/domain/ledger/days'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import type { TxStatus, TxType } from '@/lib/domain/ledger/types'
import {
  accrualError,
  accrualStateOf,
  emptyAccrual,
  type AccrualError,
  type AccrualState,
} from '@/lib/domain/transaction-form/accrual'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Transaction } from '@/types'

/** Everything the form edits, as typed. */
export interface FormState {
  type: TxType
  /** What the person chose; a future payment date forces `planned` (see `effectiveStatus`). */
  status: TxStatus
  accountId: string
  toAccountId: string
  amount: string
  toAmount: string
  categoryId: string
  counterpartyId: string
  /** `YYYY-MM-DD`. */
  paymentDate: string
  accrual: AccrualState
  description: string
  isRecurring: boolean
}

export interface InitialStateOptions {
  transaction?: Transaction
  defaultType: TxType
  defaultAccountId: string
  today: string
  /** Formats a stored amount the way the amount input shows it (locale aware). */
  formatAmount: (amount: number) => string
}

export function initialFormState(o: InitialStateOptions): FormState {
  const tx = o.transaction
  if (!tx) {
    return {
      type: o.defaultType,
      status: 'actual',
      accountId: o.defaultAccountId,
      toAccountId: '',
      amount: '',
      toAmount: '',
      categoryId: '',
      counterpartyId: '',
      paymentDate: o.today,
      accrual: emptyAccrual(o.today),
      description: '',
      isRecurring: false,
    }
  }
  const paymentDate = tx.date.toISOString().slice(0, 10)
  return {
    type: tx.type,
    status: tx.status,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId ?? '',
    amount: o.formatAmount(tx.amount),
    toAmount: tx.toAmount !== undefined ? o.formatAmount(tx.toAmount) : '',
    categoryId: tx.categoryId ?? '',
    counterpartyId: tx.counterpartyId ?? '',
    paymentDate,
    accrual: tx.type === 'transfer' ? emptyAccrual(paymentDate) : accrualStateOf(tx.accrual, paymentDate),
    description: tx.description ?? '',
    isRecurring: tx.isRecurring,
  }
}

/** The message keys under `forms.transaction.errors`. */
export type FormErrorMessage = 'account' | 'amount' | 'toAccount' | 'sameAccount' | 'amountTo' | 'paymentDate' | AccrualError
export type FormErrors = Partial<
  Record<'accountId' | 'amount' | 'toAccountId' | 'toAmount' | 'paymentDate' | 'accrual', FormErrorMessage>
>

export function validateState(state: FormState, o: { crossCurrency: boolean }): FormErrors {
  const errors: FormErrors = {}
  if (!state.accountId) errors.accountId = 'account'
  const amount = parseAmountInput(state.amount)
  if (amount === null || amount <= 0) errors.amount = 'amount'
  if (!isDay(state.paymentDate) || state.paymentDate < MIN_DAY) errors.paymentDate = 'paymentDate'
  if (state.type === 'transfer') {
    if (!state.toAccountId) errors.toAccountId = 'toAccount'
    else if (state.toAccountId === state.accountId) errors.toAccountId = 'sameAccount'
    if (o.crossCurrency) {
      const received = parseAmountInput(state.toAmount)
      if (received === null || received <= 0) errors.toAmount = 'amountTo'
    }
  } else {
    const accrual = accrualError(state.accrual, state.paymentDate)
    if (accrual) errors.accrual = accrual
  }
  return errors
}

const SCALAR_FIELDS = [
  'type', 'status', 'accountId', 'toAccountId', 'amount', 'toAmount', 'categoryId', 'counterpartyId',
  'paymentDate', 'isRecurring',
] as const

/** Whether the form holds anything the stored (or empty) baseline does not. Whitespace around the description is not a change. */
export function isDirty(baseline: FormState, current: FormState): boolean {
  if (SCALAR_FIELDS.some((k) => baseline[k] !== current[k])) return true
  if (baseline.description.trim() !== current.description.trim()) return true
  const a = baseline.accrual
  const b = current.accrual
  return a.on !== b.on || a.mode !== b.mode || a.date !== b.date || a.from !== b.from || a.to !== b.to
}
