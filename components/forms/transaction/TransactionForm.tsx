'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { AmountFields } from '@/components/forms/transaction/AmountFields'
import { ConfirmDialog } from '@/components/forms/transaction/ConfirmDialog'
import { CounterpartyField } from '@/components/forms/transaction/CounterpartyField'
import { DatesFields } from '@/components/forms/transaction/DatesFields'
import { StatusField } from '@/components/forms/transaction/StatusField'
import { TagsField } from '@/components/forms/transaction/TagsField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { LedgerApiError, createTransaction, deleteTransaction, updateTransaction } from '@/lib/api/ledger-client'
import { buildCreateDraft, buildEditDraft, categoryAfterTypeChange, stateToDraft } from '@/lib/api/transaction-draft'
import { restoreTransaction, revertTransaction } from '@/lib/api/transaction-undo'
import type { TxType } from '@/lib/domain/ledger/types'
import { effectiveStatus, isFutureDay, paidDay } from '@/lib/domain/transaction-form/status'
import { initialFormState, isDirty, validateState, type FormErrors, type FormState } from '@/lib/domain/transaction-form/state'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { undoToast } from '@/lib/ui/undo-toast'
import { cn } from '@/lib/utils'
import { formatAmountInput } from '@/lib/utils/amount-input'
import { todayDay } from '@/lib/utils/today'
import type { Account, Category, Transaction } from '@/types'

/** Used when neither the account nor the company says which currency to preselect. */
const FALLBACK_CURRENCY = 'PLN'

interface TransactionFormProps {
  orgId: string
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  transaction?: Transaction
  defaultType?: Transaction['type']
  /** The company currency: preselected when the chosen account has none to offer, and what foreign amounts are converted to. */
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
  const { locale, money } = useFormatters()
  const categoryName = useCategoryName()
  const isEdit = !!transaction
  // An operation imported from a bank keeps its amount, payment date, account and type (the server refuses to change them too).
  const bankLocked = transaction?.bank !== undefined
  const today = todayDay()

  // What the form is compared with to know whether anything was typed: the stored operation, or an empty form.
  const [baseline, setBaseline] = useState<FormState>(() =>
    initialFormState({
      transaction,
      defaultType,
      defaultAccountId: accounts[0]?.id ?? '',
      today,
      formatAmount: (amount) => formatAmountInput(amount, locale),
    }),
  )
  const [state, setState] = useState<FormState>(baseline)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  // Set synchronously: `busy` only changes on the next render, and two key events can arrive in one tick.
  const inFlight = useRef(false)
  const { counterparties } = useCounterparties(orgId)
  // The form is mounted inside the shell (ShellProvider and the journal), which knows the role.
  const { can } = useShell()
  const { tags } = useTags(orgId)
  // One id per operation being created: a retry or a double click creates it once on the server.
  const clientIdRef = useRef(crypto.randomUUID())

  const patch = (changes: Partial<FormState>) => setState((s) => ({ ...s, ...changes }))

  const account = accounts.find((a) => a.id === state.accountId)
  const toAccount = accounts.find((a) => a.id === state.toAccountId)
  const baseCurrency = defaultCurrency ?? FALLBACK_CURRENCY
  // The operation is always in the currency of its account.
  const currency = account?.currency ?? baseCurrency
  const crossCurrency = state.type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency
  const status = effectiveStatus(state.status, state.paymentDate, today)
  const futureDate = isFutureDay(state.paymentDate, today)
  const dirty = isDirty(baseline, state)

  const categories = state.type === 'income' ? incomeCategories : expenseCategories
  const categoryLabel = (category: Category): string => {
    const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined
    return parent ? `${categoryName(parent)} › ${categoryName(category)}` : categoryName(category)
  }

  // Focus the amount shortly after the form opens, unless the person has already started in another field:
  // a late focus() would pull the next keystrokes into the amount.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const active = document.activeElement
      const typing =
        active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement
      if (!typing) amountRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [open])

  // A category belongs to one type: it is cleared when the user picks another tab, never on mount.
  const changeType = (next: TxType) =>
    setState((s) => ({ ...s, categoryId: categoryAfterTypeChange(s.categoryId, s.type, next), type: next }))

  const saveErrorMessage = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      if (e.code === 'counterparty_archived') return t('errors.counterpartyArchived')
      if (e.code === 'counterparty_not_found') return t('errors.counterpartyMissing')
      if (e.code === 'bank_locked') return t('errors.bankLocked')
      if (e.code === 'tag_archived') return t('errors.tagArchived')
      if (e.code === 'tag_not_found') return t('errors.tagMissing')
    }
    return t('errors.save')
  }

  const submit = async (addSimilar = false) => {
    if (inFlight.current) return
    const found = validateState(state, { crossCurrency })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (transaction && !dirty) {
      onClose()
      return
    }
    inFlight.current = true
    setBusy('save')
    try {
      const form = stateToDraft(state, { today, crossCurrency })
      if (transaction) {
        await updateTransaction(orgId, transaction.id, buildEditDraft(transaction, form))
        undoToast({
          message: t('saved'),
          actionLabel: t('undo'),
          failureMessage: t('undoFailed'),
          id: `undo-${transaction.id}`,
          undo: () => revertTransaction(orgId, transaction),
        })
      } else {
        await createTransaction(orgId, buildCreateDraft(form), clientIdRef.current)
        clientIdRef.current = crypto.randomUUID()
      }
      if (addSimilar) {
        const next = { ...state, amount: '', toAmount: '', description: '' }
        setState(next)
        setBaseline(next)
        amountRef.current?.focus()
      } else {
        onClose()
      }
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!transaction || inFlight.current) return
    inFlight.current = true
    setBusy('delete')
    try {
      await deleteTransaction(orgId, transaction.id)
      undoToast({
        message: t('deleted'),
        actionLabel: t('undo'),
        failureMessage: t('undoFailed'),
        id: `undo-${transaction.id}`,
        undo: () => restoreTransaction(orgId, transaction),
      })
      onClose()
    } catch {
      toast.error(t('errors.delete'))
      setConfirm(null)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  // Closing a form that holds changes asks first; an untouched form closes at once.
  const requestClose = () => {
    // A question is open: Esc answers that question only, it must not also close the form behind it.
    if (busy || confirm) return
    if (dirty) setConfirm('discard')
    else onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return
    // Keys typed in a dialog opened from here (a new counterparty) bubble through React but are not ours.
    if (!e.currentTarget.contains(e.target as Node)) return
    if ((e.target as HTMLElement).closest('[role="combobox"],[role="listbox"],button')) return
    e.preventDefault()
    void submit(false)
  }

  const markPaid = () => patch({ status: 'actual', paymentDate: paidDay(state.paymentDate, today) })

  // The delete question names the operation, and warns when «Скасувати» cannot bring it back:
  // undo re-creates it, and the server refuses an archived counterparty on create.
  const deleteBody = (() => {
    if (!transaction) return ''
    const what = [transaction.description, money(transaction.amount, transaction.currency)].filter(Boolean).join(' · ')
    const counterparty = transaction.counterpartyId ? counterparties.find((c) => c.id === transaction.counterpartyId) : undefined
    return [`${what}. ${t('deleteBody')}`, counterparty?.archived ? t('deleteArchivedWarning') : null].filter(Boolean).join(' ')
  })()

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
          </DialogHeader>
          {bankLocked && (
            <p data-testid="bank-locked-hint" className="text-xs text-ink-muted">
              {t('bankLockedHint')}
            </p>
          )}

          <Tabs value={state.type} onValueChange={(value) => changeType(value as TxType)}>
            <TabsList className="w-full">
              <TabsTrigger value="income" disabled={bankLocked} className="flex-1 data-active:text-income">
                {t('income')}
              </TabsTrigger>
              <TabsTrigger value="expense" disabled={bankLocked} className="flex-1 data-active:text-expense">
                {t('expense')}
              </TabsTrigger>
              <TabsTrigger value="transfer" disabled={bankLocked} className="flex-1">
                {t('transfer')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={state.type} className="mt-4 space-y-4">
              {/* A disabled fieldset disables the native controls and the segmented buttons inside it. */}
              <fieldset disabled={bankLocked} className="m-0 min-w-0 space-y-4 border-0 p-0">
                <StatusField status={status} locked={futureDate} onChange={(next) => patch({ status: next })} />

                <AmountFields
                  state={state}
                  status={status}
                  accounts={accounts}
                  baseCurrency={baseCurrency}
                  currency={currency}
                  toCurrency={crossCurrency && toAccount ? toAccount.currency : null}
                  errors={errors}
                  amountRef={amountRef}
                  onChange={patch}
                />
              </fieldset>

              {state.type !== 'transfer' && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="tx-category">{t('category')}</Label>
                    <NativeSelect
                      id="tx-category"
                      wrapperClassName="w-full"
                      value={state.categoryId}
                      onChange={(e) => patch({ categoryId: e.target.value })}
                    >
                      <option value="">{t('noCategory')}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryLabel(c)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  <CounterpartyField orgId={orgId} counterparties={counterparties} value={state.counterpartyId} onChange={(id) => patch({ counterpartyId: id })} />
                </>
              )}

              <DatesFields
                paymentDate={state.paymentDate}
                accrual={state.accrual}
                showAccrual={state.type !== 'transfer'}
                errors={errors}
                paymentLocked={bankLocked}
                onChange={patch}
              />

              <div className="space-y-1">
                <Label htmlFor="tx-desc">{t('description')}</Label>
                <Input
                  id="tx-desc"
                  value={state.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder={t('descriptionPlaceholder')}
                />
              </div>

              {/* Tags are not part of the bank lock (S10t): an imported operation can be tagged too. */}
              <TagsField orgId={orgId} tags={tags} value={state.tagIds} onChange={(ids) => patch({ tagIds: ids })} canCreate={can('data.write')} />

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink"
              >
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
              </button>

              {showAdvanced && (
                <div className="space-y-3 rounded-control bg-muted p-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.isRecurring}
                      onChange={(e) => patch({ isRecurring: e.target.checked })}
                      className="accent-brand"
                    />
                    <span className="text-sm">{t('recurring')}</span>
                    {state.isRecurring && (
                      <Badge variant="secondary" className="text-xs">
                        {t('recurringBadge')}
                      </Badge>
                    )}
                  </label>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {isEdit && (
              <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => setConfirm('delete')} className="sm:mr-auto">
                {t('delete')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={requestClose} className={cn(!isEdit && 'sm:mr-auto')}>
              {tCommon('cancel')}
            </Button>
            {!isEdit && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void submit(true)}>
                {t('addAnother')}
              </Button>
            )}
            {isEdit && status === 'planned' && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={markPaid}>
                {t('markPaid')}
              </Button>
            )}
            <Button type="button" disabled={busy !== null} onClick={() => void submit(false)}>
              {busy === 'save' ? tForms('saving') : isEdit ? tCommon('save') : t('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm === 'delete'}
        title={t('deleteTitle')}
        body={deleteBody}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={tCommon('cancel')}
        destructive
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title={t('discardTitle')}
        body={t('discardBody')}
        confirmLabel={t('discardConfirm')}
        cancelLabel={t('discardStay')}
        onConfirm={onClose}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
