'use client'

import { useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { CounterpartyPicker } from '@/components/counterparties/CounterpartyPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { draftFromRule, draftToInput, emptyDraft, newCondition, type DraftCondition, type RuleDraft } from '@/lib/api/rule-draft'
import { createRule, deleteRule, previewRule, updateRule } from '@/lib/api/rules-client'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { LEDGER_CURRENCIES } from '@/lib/domain/ledger/types'
import { MAX_CONDITIONS, TEXT_OPS, type ListedRule, type PreviewResult, type TextOp } from '@/lib/domain/rules/types'
import type { Locale } from '@/lib/i18n/config'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import type { Account, Category } from '@/types'

interface Props {
  orgId: string
  /** The rule to edit; absent for a new one. */
  rule?: ListedRule
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  counterparties: Counterparty[]
  /** The company currency: a new amount condition starts in it ('' while the company loads; the server then fills it). */
  currency: string
  onClose: () => void
  /** After a save or a delete: the list is read again. */
  onSaved: () => void
}

type Busy = 'save' | 'delete' | 'check' | null

/** The rule editor: name, type, conditions, actions and «Перевірити» against the existing operations. */
export function RuleEditor({ orgId, rule, accounts, incomeCategories, expenseCategories, counterparties, currency, onClose, onSaved }: Props) {
  const t = useTranslations('settings.rules')
  const tCommon = useTranslations('common')
  const locale = useLocale() as Locale
  const categoryName = useCategoryName()
  const [draft, setDraft] = useState<RuleDraft>(() => (rule ? draftFromRule(rule, locale) : emptyDraft()))
  const [busy, setBusy] = useState<Busy>(null)
  // The answer of «Перевірити»; any change of the draft makes it stale, so it is cleared.
  const [check, setCheck] = useState<PreviewResult | null>(null)

  const input = draftToInput(draft)
  const categories = draft.type === 'income' ? incomeCategories : expenseCategories
  const missingCategory = draft.categoryId !== '' && !categories.some((c) => c.id === draft.categoryId)

  const change = (next: Partial<RuleDraft>) => {
    setDraft((d) => ({ ...d, ...next }))
    setCheck(null)
  }
  const changeCondition = (index: number, next: DraftCondition) => change({ conditions: draft.conditions.map((c, i) => (i === index ? next : c)) })

  const errorText = (e: unknown): string => {
    const code = e instanceof LedgerApiError ? e.code : ''
    if (code === 'category_not_found') return t('errors.category')
    if (code === 'counterparty_not_found') return t('errors.counterpartyMissing')
    if (code === 'counterparty_archived') return t('errors.counterpartyArchived')
    if (code === 'limit_reached') return t('errors.limit')
    if (code === 'not_found') return t('errors.gone')
    if (code === 'invalid_input') return t('errors.invalid')
    return t('errors.save')
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (input === null || busy !== null) return
    setBusy('save')
    try {
      if (rule) await updateRule(orgId, rule.id, input)
      else await createRule(orgId, input)
      toast.success(t('saved'))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorText(err))
      setBusy(null)
    }
  }

  const runCheck = async () => {
    if (input === null) return
    setBusy('check')
    try {
      setCheck(await previewRule(orgId, input))
    } catch {
      toast.error(t('errors.check'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!rule || !window.confirm(t('editor.deleteConfirm', { name: rule.name }))) return
    setBusy('delete')
    try {
      await deleteRule(orgId, rule.id)
      toast.success(t('deleted'))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorText(err))
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? t('editor.titleEdit') : t('editor.titleNew')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="rule-name">{t('editor.name')}</Label>
            <Input id="rule-name" maxLength={100} value={draft.name} onChange={(e) => change({ name: e.target.value })} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('editor.type')}
              value={draft.type}
              onChange={(type) => {
                // A category belongs to one type: switching the type drops the chosen one.
                if (type !== draft.type) change({ type, categoryId: '' })
              }}
              options={[
                { value: 'expense', label: t('type.expense') },
                { value: 'income', label: t('type.income') },
              ]}
            />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="accent-brand" checked={draft.active} onChange={(e) => change({ active: e.target.checked })} />
              {t('editor.active')}
            </label>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">{t('editor.conditions')}</legend>
            {draft.conditions.map((c, i) => (
              <ConditionRow
                key={i}
                index={i}
                condition={c}
                accounts={accounts}
                currency={currency}
                onChange={(next) => changeCondition(i, next)}
                onRemove={draft.conditions.length > 1 ? () => change({ conditions: draft.conditions.filter((_, j) => j !== i) }) : undefined}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.conditions.length >= MAX_CONDITIONS}
              onClick={() => change({ conditions: [...draft.conditions, newCondition('text', currency)] })}
            >
              <Plus />
              {t('editor.addCondition')}
            </Button>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">{t('editor.actions')}</legend>
            <div className="space-y-1">
              <Label htmlFor="rule-category">{t('editor.category')}</Label>
              <NativeSelect id="rule-category" value={draft.categoryId} onChange={(e) => change({ categoryId: e.target.value })}>
                <option value="">{t('editor.noCategory')}</option>
                {missingCategory && (
                  <option value={draft.categoryId} disabled>
                    {t('summary.missing')}
                  </option>
                )}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-counterparty">{t('editor.counterparty')}</Label>
              <CounterpartyPicker
                id="rule-counterparty"
                counterparties={counterparties.filter((c) => !c.archived || c.id === draft.counterpartyId)}
                value={draft.counterpartyId}
                onChange={(id) => change({ counterpartyId: id })}
              />
            </div>
          </fieldset>

          <div className="space-y-2">
            <Button type="button" variant="soft" onClick={() => void runCheck()} disabled={input === null || busy !== null}>
              {busy === 'check' ? t('editor.checking') : t('editor.check')}
            </Button>
            {check && (
              <p data-testid="rule-check-result" className="text-sm text-ink" aria-live="polite">
                {t('editor.checkResult', { scanned: check.scanned, matched: check.matched })}
                {check.capped && <span className="block text-xs text-ink-muted">{t('editor.checkCapped')}</span>}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {rule ? (
              <Button type="button" variant="ghost" className="text-expense" onClick={() => void remove()} disabled={busy !== null}>
                {tCommon('delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy === 'save'}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={input === null || busy !== null}>
                {busy === 'save' ? t('editor.saving') : tCommon('save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RowProps {
  index: number
  condition: DraftCondition
  accounts: Account[]
  currency: string
  onChange: (next: DraftCondition) => void
  /** Absent for the only condition: a rule needs at least one. */
  onRemove?: () => void
}

/** One condition: its kind, then the fields of that kind. Ids `rule-cond-<index>-*` (e2e uses them). */
function ConditionRow({ index, condition, accounts, currency, onChange, onRemove }: RowProps) {
  const t = useTranslations('settings.rules.editor')
  const id = `rule-cond-${index}`
  return (
    <div data-testid="rule-condition" className="space-y-3 rounded-field border border-line p-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${id}-kind`}>{t('kind.label')}</Label>
          <NativeSelect id={`${id}-kind`} value={condition.kind} onChange={(e) => onChange(newCondition(e.target.value as DraftCondition['kind'], currency))}>
            <option value="text">{t('kind.text')}</option>
            <option value="account">{t('kind.account')}</option>
            <option value="amount">{t('kind.amount')}</option>
          </NativeSelect>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon" aria-label={t('removeCondition', { index: index + 1 })} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>

      {condition.kind === 'text' && (
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="space-y-1">
            <Label htmlFor={`${id}-op`}>{t('op.label')}</Label>
            <NativeSelect id={`${id}-op`} value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as TextOp })}>
              {TEXT_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-values`}>{t('values')}</Label>
            <Input id={`${id}-values`} value={condition.values} onChange={(e) => onChange({ ...condition, values: e.target.value })} aria-describedby={`${id}-hint`} />
          </div>
          <p id={`${id}-hint`} className="text-xs text-ink-muted sm:col-span-2">
            {t('valuesHint')}
          </p>
        </div>
      )}

      {condition.kind === 'account' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink">{t('accounts')}</legend>
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="accent-brand"
                checked={condition.accountIds.includes(a.id)}
                onChange={(e) =>
                  onChange({
                    ...condition,
                    accountIds: e.target.checked ? [...condition.accountIds, a.id] : condition.accountIds.filter((x) => x !== a.id),
                  })
                }
              />
              {a.name}
            </label>
          ))}
        </fieldset>
      )}

      {condition.kind === 'amount' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-currency`}>{t('currency')}</Label>
            <NativeSelect id={`${id}-currency`} value={condition.currency} onChange={(e) => onChange({ ...condition, currency: e.target.value })}>
              {LEDGER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-min`}>{t('min')}</Label>
            <Input id={`${id}-min`} inputMode="decimal" value={condition.min} onChange={(e) => onChange({ ...condition, min: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-max`}>{t('max')}</Label>
            <Input id={`${id}-max`} inputMode="decimal" value={condition.max} onChange={(e) => onChange({ ...condition, max: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  )
}
