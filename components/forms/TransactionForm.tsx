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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
// Note: account/category selects use native <select> for reliable display
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { createTransaction, updateTransaction, type TransactionDraft } from '@/lib/api/ledger-client'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatAmountInput, parseAmountInput } from '@/lib/utils/amount-input'
import { todayUtcDay } from '@/lib/utils/today'
import type { Transaction, Account, Category } from '@/types'

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

  const [type, setType] = useState<Transaction['type']>(transaction?.type ?? defaultType)
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId ?? '')
  const [amount, setAmount] = useState(transaction ? formatAmountInput(transaction.amount, locale) : '')
  const [toAmount, setToAmount] = useState(
    transaction?.toAmount !== undefined ? formatAmountInput(transaction.toAmount, locale) : '',
  )
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '')
  const [date, setDate] = useState(toInputDate(transaction?.date ?? todayUtcDay()))
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [isRecurring, setIsRecurring] = useState(transaction?.isRecurring ?? false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const categories = type === 'income' ? incomeCategories : expenseCategories
  const amountRef = useRef<HTMLInputElement>(null)
  // One id per operation being created: a retry or a double click creates it once on the server.
  const clientIdRef = useRef(crypto.randomUUID())

  // The operation is always in the currency of its account.
  const account = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const currency = account?.currency ?? defaultCurrency ?? FALLBACK_CURRENCY
  const crossCurrency = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency

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
    if (crossCurrency) {
      const v = parseAmountInput(toAmount)
      if (v === null || v <= 0) errs.toAmount = t('errors.amountTo')
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const buildDraft = (): TransactionDraft => {
    const draft: TransactionDraft = {
      type,
      accountId,
      // validate() has already refused anything parseAmountInput cannot read.
      amount: parseAmountInput(amount) ?? 0,
      // The input is the YYYY-MM-DD string of the date field; the accrual date follows it on the server.
      paymentDate: date,
      isRecurring,
      tags: [],
      fileUrls: [],
    }
    if (categoryId && type !== 'transfer') draft.categoryId = categoryId
    if (type === 'transfer') draft.toAccountId = toAccountId
    if (crossCurrency) draft.toAmount = parseAmountInput(toAmount) ?? 0
    if (description.trim()) draft.description = description.trim()
    return draft
  }

  const handleSubmit = async (addAnother = false) => {
    if (!validate()) return
    setLoading(true)
    try {
      if (isEdit) {
        await updateTransaction(orgId, transaction.id, buildDraft())
      } else {
        await createTransaction(orgId, buildDraft(), clientIdRef.current)
        clientIdRef.current = crypto.randomUUID()
      }
      if (addAnother) {
        setAmount('')
        setToAmount('')
        setDescription('')
        amountRef.current?.focus()
      } else {
        onClose()
      }
    } catch {
      toast.error(t('errors.save'))
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
                    onChange={(e) => setAccountId(e.target.value)}
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
                    <div className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm">
                      {currency}
                    </div>
                  </div>
                </div>

                {/* Amount received (a transfer between accounts in different currencies) */}
                {panel === 'transfer' && crossCurrency && toAccount && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="tx-amount-to">{t('amountTo')}</Label>
                      <Input
                        id="tx-amount-to"
                        type="text"
                        inputMode="decimal"
                        value={toAmount}
                        onChange={(e) => setToAmount(e.target.value)}
                        className="tabular-nums text-lg font-semibold"
                        style={{ color: TYPE_COLORS[panel] }}
                      />
                      {errors.toAmount && <p className="text-xs text-red-500">{errors.toAmount}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label>{t('currency')}</Label>
                      <div className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm">
                        {toAccount.currency}
                      </div>
                    </div>
                  </div>
                )}

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
