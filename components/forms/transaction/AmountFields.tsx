'use client'

import type { Ref } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { TxStatus, TxType } from '@/lib/domain/ledger/types'
import { convertApprox, rateLine } from '@/lib/domain/transaction-form/rate'
import type { FormErrors, FormState } from '@/lib/domain/transaction-form/state'
import { useRatePreview } from '@/lib/hooks/useRatePreview'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { parseAmountInput } from '@/lib/utils/amount-input'
import type { Account } from '@/types'

const AMOUNT_COLOR: Record<TxType, string> = { income: 'text-income', expense: 'text-expense', transfer: 'text-ink' }

const READONLY_BOX = 'flex h-9 w-full items-center rounded-control border border-input bg-surface px-3 text-sm'

interface Props {
  state: FormState
  /** The status that will be saved; a planned operation has no conversion, so no rate hint. */
  status: TxStatus
  accounts: Account[]
  /** The company currency: what a foreign amount is converted to in the hint. */
  baseCurrency: string
  /** The currency of the chosen account. */
  currency: string
  /** The currency of the target account, only when a transfer crosses currencies. */
  toCurrency: string | null
  errors: FormErrors
  amountRef: Ref<HTMLInputElement>
  onChange: (patch: Partial<FormState>) => void
}

export function AmountFields({ state, status, accounts, baseCurrency, currency, toCurrency, errors, amountRef, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  const { money, number, date } = useFormatters()
  const isTransfer = state.type === 'transfer'
  const typedAmount = parseAmountInput(state.amount)

  const needsRate = !isTransfer && status === 'actual' && currency !== baseCurrency
  const preview = useRatePreview(needsRate ? currency : null, baseCurrency, state.paymentDate)
  const line = toCurrency === null ? null : rateLine(typedAmount ?? 0, currency, parseAmountInput(state.toAmount) ?? 0, toCurrency)

  const color = AMOUNT_COLOR[state.type]
  const error = (key: keyof FormErrors) => {
    const message = errors[key]
    return message ? <p className="text-xs text-expense">{t(`errors.${message}`)}</p> : null
  }

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="tx-account">{isTransfer ? t('accountFrom') : t('account')}</Label>
        <NativeSelect
          id="tx-account"
          wrapperClassName="w-full"
          value={state.accountId}
          onChange={(e) => onChange({ accountId: e.target.value })}
        >
          <option value="">{t('chooseAccount')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        {error('accountId')}
      </div>

      {isTransfer && (
        <div className="space-y-1">
          <Label htmlFor="tx-account-to">{t('accountTo')}</Label>
          <NativeSelect
            id="tx-account-to"
            wrapperClassName="w-full"
            value={state.toAccountId}
            onChange={(e) => onChange({ toAccountId: e.target.value })}
          >
            <option value="">{t('chooseAccount')}</option>
            {accounts
              .filter((a) => a.id !== state.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </NativeSelect>
          {error('toAccountId')}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="tx-amount">{t('amount')}</Label>
          {/* Text, not number: a number field rejects `1 234,50` and depends on the browser's locale. */}
          <Input
            id="tx-amount"
            ref={amountRef}
            type="text"
            inputMode="decimal"
            value={state.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            className={cn('text-lg font-semibold tabular-nums', color)}
          />
          {error('amount')}
        </div>
        <div className="space-y-1">
          <Label>{t('currency')}</Label>
          <div className={READONLY_BOX}>{currency}</div>
        </div>
      </div>

      {preview.state === 'ok' && typedAmount !== null && typedAmount > 0 && (
        <p className="text-xs tabular-nums text-ink-muted">
          {t('rateHint', {
            amount: money(convertApprox(typedAmount, preview.rate), baseCurrency),
            // The formatter works in UTC, so the stored day cannot slip to its neighbour.
            date: date(new Date(`${preview.rateDate}T00:00:00Z`), { day: 'numeric', month: 'long', year: 'numeric' }),
          })}
        </p>
      )}
      {preview.state === 'unavailable' && <p className="text-xs text-ink-muted">{t('rateUnavailable')}</p>}

      {isTransfer && toCurrency !== null && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="tx-amount-to">{t('amountTo')}</Label>
              <Input
                id="tx-amount-to"
                type="text"
                inputMode="decimal"
                value={state.toAmount}
                onChange={(e) => onChange({ toAmount: e.target.value })}
                className={cn('text-lg font-semibold tabular-nums', color)}
              />
              {error('toAmount')}
            </div>
            <div className="space-y-1">
              <Label>{t('currency')}</Label>
              <div className={READONLY_BOX}>{toCurrency}</div>
            </div>
          </div>
          {line && (
            <p className="text-xs tabular-nums text-ink-muted">
              {t('rateLine', { base: line.base, value: number(line.value, { minimumFractionDigits: 4, maximumFractionDigits: 6 }), quote: line.quote })}
            </p>
          )}
        </>
      )}
    </>
  )
}
