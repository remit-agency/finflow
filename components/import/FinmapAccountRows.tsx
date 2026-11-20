'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { parseBalanceText, type NewAccountSetting } from '@/lib/domain/import/finmap/state'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, type AccountType } from '@/lib/domain/ledger/types'

interface Props {
  /** The names of the accounts the file needs and FinFlow does not have (one row each). */
  names: string[]
  settingOf: (name: string) => NewAccountSetting
  disabled: boolean
  onChange: (name: string, patch: Partial<NewAccountSetting>) => void
}

/** One row per new account: its type, currency and the current balance the user types (fitted at the end of the import). */
export function FinmapAccountRows({ names, settingOf, disabled, onChange }: Props) {
  const t = useTranslations('import.finmap.accounts')
  const tTypes = useTranslations('common.accountTypes')
  if (names.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-ink">{t('heading')}</h3>
      <p className="text-xs text-ink-muted">{t('hint')}</p>
      {names.map((name, i) => {
        const setting = settingOf(name)
        const balanceValid = parseBalanceText(setting.balanceText, setting.currency).ok
        return (
          <div key={name} data-testid="finmap-account-row" className="grid grid-cols-1 gap-2 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_9rem]">
            <p className="min-w-0 text-sm font-medium break-words text-ink">{name}</p>
            <label className="space-y-1 text-xs text-ink-muted">
              {t('type')}
              <NativeSelect
                data-testid="finmap-account-type"
                value={setting.type}
                disabled={disabled}
                onChange={(e) => onChange(name, { type: e.target.value as AccountType })}
                className="border-line text-sm"
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tTypes(type)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-ink-muted">
              {t('currency')}
              <NativeSelect
                data-testid="finmap-account-currency"
                value={setting.currency}
                disabled={disabled}
                onChange={(e) => onChange(name, { currency: e.target.value })}
                className="border-line text-sm"
              >
                {LEDGER_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs text-ink-muted">
              {t('balance')}
              <Input
                id={`finmap-account-balance-${i}`}
                data-testid="finmap-account-balance"
                inputMode="decimal"
                autoComplete="off"
                value={setting.balanceText}
                disabled={disabled}
                aria-invalid={!balanceValid}
                aria-describedby={balanceValid ? undefined : `finmap-account-balance-error-${i}`}
                onChange={(e) => onChange(name, { balanceText: e.target.value })}
                className="text-right text-sm tabular-nums"
              />
            </label>
            {!balanceValid && (
              <p id={`finmap-account-balance-error-${i}`} role="alert" className="text-xs text-expense sm:col-span-4">
                {t('balanceInvalid')}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
