'use client'

import { useTranslations } from 'next-intl'
import { DateField } from '@/components/ui/date-field'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import type { AccrualState } from '@/lib/domain/transaction-form/accrual'
import type { FormErrors, FormState } from '@/lib/domain/transaction-form/state'

interface Props {
  paymentDate: string
  accrual: AccrualState
  /** False for a transfer: it has no accrual. */
  showAccrual: boolean
  errors: FormErrors
  onChange: (patch: Partial<FormState>) => void
}

export function DatesFields({ paymentDate, accrual, showAccrual, errors, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  const dateProps = { placeholder: t('datePlaceholder'), calendarLabel: t('openCalendar') }
  const setAccrual = (patch: Partial<AccrualState>) => onChange({ accrual: { ...accrual, ...patch } })

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="tx-date">{t('date')}</Label>
        <DateField id="tx-date" value={paymentDate} onChange={(paymentDate) => onChange({ paymentDate })} {...dateProps} />
        {errors.paymentDate && <p className="text-xs text-expense">{t(`errors.${errors.paymentDate}`)}</p>}
      </div>

      {showAccrual && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={accrual.on}
              onChange={(e) => setAccrual({ on: e.target.checked })}
              className="accent-brand"
            />
            <span>{t('accrualSwitch')}</span>
          </label>

          {accrual.on && (
            <div className="space-y-3 rounded-control bg-muted p-3">
              <Segmented
                label={t('accrualMode')}
                value={accrual.mode}
                onChange={(mode) =>
                  // A period that was never set (or covers one day) follows the payment date instead of the day the form opened.
                  setAccrual(
                    mode === 'period' && accrual.from === accrual.to ? { mode, from: paymentDate, to: paymentDate } : { mode },
                  )
                }
                options={[
                  { value: 'date', label: t('accrualModeDate') },
                  { value: 'period', label: t('accrualModePeriod') },
                ]}
              />
              {accrual.mode === 'date' ? (
                <div className="space-y-1">
                  <Label htmlFor="tx-accrual-date">{t('accrualDate')}</Label>
                  <DateField
                    id="tx-accrual-date"
                    value={accrual.date ?? paymentDate}
                    onChange={(date) => setAccrual({ date })}
                    {...dateProps}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="tx-accrual-from">{t('accrualFrom')}</Label>
                    <DateField
                      id="tx-accrual-from"
                      value={accrual.from}
                      onChange={(from) => setAccrual({ from })}
                      {...dateProps}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tx-accrual-to">{t('accrualTo')}</Label>
                    <DateField
                      id="tx-accrual-to"
                      value={accrual.to}
                      onChange={(to) => setAccrual({ to })}
                      {...dateProps}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-ink-muted">{t('accrualHint')}</p>
              {errors.accrual && <p className="text-xs text-expense">{t(`errors.${errors.accrual}`)}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
