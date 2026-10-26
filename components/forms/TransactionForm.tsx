'use client'

import { useState, useEffect, useRef } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
// Note: account/category selects use native <select> for reliable display
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { createTransaction, updateTransaction } from '@/lib/firebase/transactions'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatAmountInput, parseAmountInput, roundAmount } from '@/lib/utils/amount-input'
import { todayUtcDay } from '@/lib/utils/today'
import type { Transaction, Account, Category } from '@/types'

const CURRENCIES = ['UAH', 'EUR', 'USD', 'PLN']

/** Used when neither the account nor the company says which currency to preselect. */
const FALLBACK_CURRENCY = 'PLN'

function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

interface TransactionFormProps {
  orgId: string
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  transaction?: Transaction
  defaultType?: Transaction['type']
  /** The company currency: preselected when the chosen account has none to offer. */
  defaultCurrency?: string
  open: boolean
  onClose: () => void
}

export function TransactionForm({
  orgId,
  accounts,
  incomeCategories,
  expenseCategories,
  transaction,
  defaultType = 'income',
  defaultCurrency,
  open,
  onClose,
}: TransactionFormProps) {
  const t = useTranslations('forms.transaction')
  const tForms = useTranslations('forms')
  const tCommon = useTranslations('common')
  const { locale } = useFormatters()
  const categoryName = useCategoryName()
  const isEdit = !!transaction
  const currencyOf = (id: string) => accounts.find((a) => a.id === id)?.currency ?? defaultCurrency ?? FALLBACK_CURRENCY

  const [type, setType] = useState<Transaction['type']>(transaction?.type ?? defaultType)
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState(transaction?.counterpartyId ?? '')
  const [amount, setAmount] = useState(transaction ? formatAmountInput(transaction.amount, locale) : '')
  // A new operation starts in the currency of its account (else the company's); picking another
  // account moves it along until the person has chosen a currency themselves.
  const [currency, setCurrency] = useState(transaction?.currency ?? currencyOf(transaction?.accountId ?? accounts[0]?.id ?? ''))
  const [currencyChosen, setCurrencyChosen] = useState(false)
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '')
  const [date, setDate] = useState(toInputDate(transaction?.date ?? todayUtcDay()))
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [isRecurring, setIsRecurring] = useState(transaction?.isRecurring ?? false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const categories = type === 'income' ? incomeCategories : expenseCategories
  const amountRef = useRef<HTMLInputElement>(null)

  // Reset form when opened with new defaultType
  useEffect(() => {
    if (open && !isEdit) {
      setType(defaultType)
      setCategoryId('')
    }
  }, [open, defaultType, isEdit])

  // Reset category when type changes
  useEffect(() => {
    setCategoryId('')
  }, [type])

  // Focus amount on open
  useEffect(() => {
    if (open) {
      setTimeout(() => amountRef.current?.focus(), 100)
    }
  }, [open])

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!accountId) errs.accountId = t('errors.account')
    const parsedAmount = parseAmountInput(amount)
    if (parsedAmount === null || parsedAmount <= 0) errs.amount = t('errors.amount')
    if (type === 'transfer' && !toAccountId) errs.toAccountId = t('errors.toAccount')
    if (type === 'transfer' && toAccountId === accountId)
      errs.toAccountId = t('errors.sameAccount')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const buildData = (): Omit<Transaction, 'id' | 'orgId'> => {
    const data: Omit<Transaction, 'id' | 'orgId'> = {
      type,
      accountId,
      // validate() has already refused anything parseAmountInput cannot read.
      // Sub-cent values are not money: store what the prefill would show.
      amount: roundAmount(parseAmountInput(amount) ?? 0),
      currency,
      date: new Date(date),
      isRecurring,
      tags: [],
      fileUrls: [],
    }
    if (categoryId) data.categoryId = categoryId
    if (type === 'transfer' && toAccountId) data.counterpartyId = toAccountId
    if (description.trim()) data.description = description.trim()
    return data
  }

  const handleSubmit = async (addAnother = false) => {
    if (!validate()) return
    setLoading(true)
    try {
      if (isEdit) {
        await updateTransaction(orgId, transaction.id, buildData())
      } else {
        await createTransaction(orgId, buildData())
      }
      if (addAnother) {
        setAmount('')
        setDescription('')
        amountRef.current?.focus()
      } else {
        onClose()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(false)
    }
  }

  const TYPE_COLORS: Record<Transaction['type'], string> = {
    income: '#22c55e',
    expense: '#ef4444',
    transfer: '#6366f1',
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type tabs */}
          <Tabs value={type} onValueChange={(v) => setType(v as Transaction['type'])}>
            <TabsList className="w-full">
              <TabsTrigger value="income" className="flex-1 data-[state=active]:text-green-600">
                {t('income')}
              </TabsTrigger>
              <TabsTrigger value="expense" className="flex-1 data-[state=active]:text-red-500">
                {t('expense')}
              </TabsTrigger>
              <TabsTrigger value="transfer" className="flex-1 data-[state=active]:text-indigo-500">
                {t('transfer')}
              </TabsTrigger>
            </TabsList>

            {(['income', 'expense', 'transfer'] as const).map((panel) => (
              <TabsContent key={panel} value={panel} className="space-y-4 mt-4">
                {/* Account */}
                <div className="space-y-1">
                  <Label>{panel === 'transfer' ? t('accountFrom') : t('account')}</Label>
                  <select
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value)
                      if (!isEdit && !currencyChosen) setCurrency(currencyOf(e.target.value))
                    }}
                    className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-[#00c896]"
                  >
                    <option value="">{t('chooseAccount')}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  {errors.accountId && <p className="text-xs text-red-500">{errors.accountId}</p>}
                </div>

                {/* To account (transfer only) */}
                {panel === 'transfer' && (
                  <div className="space-y-1">
                    <Label>{t('accountTo')}</Label>
                    <select
                      value={toAccountId}
                      onChange={(e) => setToAccountId(e.target.value)}
                      className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-[#00c896]"
                    >
                      <option value="">{t('chooseAccount')}</option>
                      {accounts.filter((a) => a.id !== accountId).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    {errors.toAccountId && (
                      <p className="text-xs text-red-500">{errors.toAccountId}</p>
                    )}
                  </div>
                )}

                {/* Amount + currency */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="tx-amount">{t('amount')}</Label>
                    {/* Text, not number: a number field rejects `1 234,50` and depends on the browser's locale. */}
                    <Input
                      id="tx-amount"
                      ref={amountRef}
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="tabular-nums text-lg font-semibold"
                      style={{ color: TYPE_COLORS[panel] }}
                    />
                    {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>{t('currency')}</Label>
                    <Select value={currency} onValueChange={(v) => {
                        setCurrencyChosen(true)
                        setCurrency((current) => v ?? current)
                      }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Category (not for transfer) */}
                {panel !== 'transfer' && (
                  <div className="space-y-1">
                    <Label>{t('category')}</Label>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-[#00c896]"
                    >
                      <option value="">{t('noCategory')}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{categoryName(c)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Date */}
                <div className="space-y-1">
                  <Label htmlFor="tx-date">{t('date')}</Label>
                  <Input
                    id="tx-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <Label htmlFor="tx-desc">{t('description')}</Label>
                  <Input
                    id="tx-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                  />
                </div>

                {/* Advanced section */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {showAdvanced ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
                </button>

                {showAdvanced && (
                  <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRecurring}
                        onChange={(e) => setIsRecurring(e.target.checked)}
                        className="accent-[#00c896]"
                      />
                      <span className="text-sm">{t('recurring')}</span>
                      {isRecurring && (
                        <Badge variant="secondary" className="text-xs">
                          {t('recurringBadge')}
                        </Badge>
                      )}
                    </label>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="sm:mr-auto">
            {tCommon('cancel')}
          </Button>
          {!isEdit && (
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => handleSubmit(true)}
            >
              {t('addAnother')}
            </Button>
          )}
          <Button
            type="button"
            disabled={loading}
            onClick={() => handleSubmit(false)}
            style={{ backgroundColor: '#00c896' }}
          >
            {loading ? tForms('saving') : isEdit ? tCommon('save') : t('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
