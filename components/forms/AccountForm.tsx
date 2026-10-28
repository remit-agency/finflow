'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { toast } from 'sonner'
import { createAccount, updateAccount, LedgerApiError } from '@/lib/api/ledger-client'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatAmountInput, parseSignedAmountInput } from '@/lib/utils/amount-input'
import type { Account } from '@/types'

const PRESET_COLORS = [
  '#00c896',
  '#6366f1',
  '#ef4444',
  '#f97316',
  '#3b82f6',
  '#a855f7',
]

// The labels are `t('types.<type>')`.
const ACCOUNT_TYPES: Account['type'][] = ['bank', 'cash', 'card', 'crypto']

const CURRENCIES = ['UAH', 'EUR', 'USD', 'PLN']

/** Used when the company currency is not known. */
const FALLBACK_CURRENCY = 'PLN'

interface AccountFormProps {
  orgId: string
  account?: Account
  /** The company currency, preselected for a new account. */
  defaultCurrency?: string
  open: boolean
  onClose: () => void
}

export function AccountForm({ orgId, account, defaultCurrency, open, onClose }: AccountFormProps) {
  const t = useTranslations('forms.account')
  const tForms = useTranslations('forms')
  const tCommon = useTranslations('common')
  const { locale } = useFormatters()
  const isEdit = !!account

  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<Account['type']>(account?.type ?? 'bank')
  const [balance, setBalance] = useState(formatAmountInput(account?.opening ?? 0, locale))
  const [currency, setCurrency] = useState(account?.currency ?? defaultCurrency ?? FALLBACK_CURRENCY)
  const [color, setColor] = useState(account?.color ?? PRESET_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; balance?: string }>({})

  const validate = (): boolean => {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = t('errors.name')
    // The opening balance may be negative: the migration stores the legacy balance minus the sum of
    // the operations, and the prefilled `-0,10` must stay valid so the account can still be edited.
    if (parseSignedAmountInput(balance) === null) errs.balance = t('errors.balance')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const data = {
        name: name.trim(),
        type,
        currency,
        color,
        // validate() has already refused anything parseSignedAmountInput cannot read.
        opening: parseSignedAmountInput(balance) ?? 0,
      }
      if (isEdit) {
        await updateAccount(orgId, account.id, data)
      } else {
        await createAccount(orgId, data)
      }
      onClose()
    } catch (e) {
      toast.error(e instanceof LedgerApiError && e.code === 'account_has_operations' ? t('errors.hasOperations') : t('errors.save'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="acc-name">{t('name')}</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
            {errors.name && <p className="text-xs text-expense">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <Label>{t('type')}</Label>
            <NativeSelect
              wrapperClassName="w-full"
              value={type}
              onChange={(e) => setType(e.target.value as Account['type'])}
            >
              {ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType} value={accountType}>{t(`types.${accountType}`)}</option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="acc-balance">{t('opening')}</Label>
              {/* Text, not number: a number field rejects `1 234,50` and depends on the browser's locale. */}
              <Input
                id="acc-balance"
                type="text"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="font-tabular"
              />
              {errors.balance && <p className="text-xs text-expense">{errors.balance}</p>}
            </div>
            <div className="space-y-1">
              <Label>{t('currency')}</Label>
              <NativeSelect
                wrapperClassName="w-full"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('color')}</Label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-ink scale-115' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? tForms('saving') : isEdit ? tCommon('save') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
