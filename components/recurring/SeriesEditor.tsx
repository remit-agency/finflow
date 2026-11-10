'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CounterpartyField } from '@/components/forms/transaction/CounterpartyField'
import { TagsField } from '@/components/forms/transaction/TagsField'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { createSeries, updateSeries } from '@/lib/api/recurring-client'
import { editorToBody, editorToPatch, initialEditorState, validateEditor, type EditorErrors, type EditorState } from '@/lib/domain/recurring/editor'
import { FREQUENCIES, WEEKEND_RULES, type Preset, type Series } from '@/lib/domain/recurring/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { formatWeekday } from '@/lib/i18n/format'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatAmountInput } from '@/lib/utils/amount-input'
import { todayDay } from '@/lib/utils/today'
import { weekdayDate } from './labels'

interface Props {
  orgId: string
  /** The series to change; absent: a new one. */
  series?: Series
  /** A new series from a tax preset. */
  preset?: Preset
  onClose: () => void
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** Creates or changes a series (S11). Mounted only while open, so its state starts from the series or the preset. */
export function SeriesEditor({ orgId, series, preset, onClose }: Props) {
  const t = useTranslations('recurring')
  const tBulk = useTranslations('journal.bulk')
  const { locale } = useFormatters()
  const categoryName = useCategoryName()
  const { accounts, incomeCategories, expenseCategories, can } = useShell()
  const { counterparties } = useCounterparties(orgId)
  const { tags } = useTags(orgId)
  const [state, setState] = useState<EditorState>(() =>
    initialEditorState({
      series,
      preset,
      presetName: preset !== undefined ? t(`presets.${preset}`) : undefined,
      today: todayDay(),
      defaultAccountId: accounts[0]?.id ?? '',
      formatAmount: (amount) => formatAmountInput(amount, locale),
    }),
  )
  const [errors, setErrors] = useState<EditorErrors>({})
  const [busy, setBusy] = useState(false)
  const patch = (changes: Partial<EditorState>) => setState((s) => ({ ...s, ...changes }))
  const editing = series !== undefined
  const categories = state.kind === 'income' ? incomeCategories : expenseCategories
  const title = editing ? t('editor.titleEdit') : preset !== undefined ? t('editor.titlePreset', { preset: t(`presets.${preset}`) }) : t('editor.titleNew')

  const errorText = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      if (e.code === 'limit_reached') return t('editor.errors.limit')
      const key = `errors.${e.code}` as 'errors.unknown'
      if (tBulk.has(key)) return tBulk(key)
    }
    return t('editor.errors.save')
  }

  const save = async () => {
    if (busy) return
    const found = validateEditor(state)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      if (series === undefined) {
        const { created } = await createSeries(orgId, editorToBody(state))
        toast.success(t('editor.created', { count: created }))
      } else {
        const changes = editorToPatch(series, state)
        if (Object.keys(changes).length > 0) {
          await updateSeries(orgId, series.id, changes)
          toast.success(t('editor.saved'))
        }
      }
      onClose()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (show: true | undefined, text: string) => (show ? <p className="text-xs text-expense">{text}</p> : null)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {preset !== undefined && <DialogDescription>{t('presets.hint')}</DialogDescription>}
          {editing && <DialogDescription>{t('editor.rewriteHint')}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-name">{t('editor.name')}</Label>
            <Input id="series-name" value={state.name} maxLength={80} aria-invalid={errors.name} onChange={(e) => patch({ name: e.target.value })} />
            {fieldError(errors.name, t('editor.errors.name'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-kind">{t('editor.kind')}</Label>
            <NativeSelect id="series-kind" value={state.kind} disabled={editing || preset !== undefined} onChange={(e) => patch({ kind: e.target.value as EditorState['kind'], categoryId: '' })}>
              <option value="expense">{t('editor.expense')}</option>
              <option value="income">{t('editor.income')}</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-account">{t('editor.account')}</Label>
            <NativeSelect id="series-account" value={state.accountId} aria-invalid={errors.accountId} onChange={(e) => patch({ accountId: e.target.value })}>
              <option value="">{t('editor.chooseAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {fieldError(errors.accountId, t('editor.errors.account'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-amount">{t('editor.amount')}</Label>
            <Input id="series-amount" inputMode="decimal" value={state.amount} aria-invalid={errors.amount} onChange={(e) => patch({ amount: e.target.value })} />
            {fieldError(errors.amount, t('editor.errors.amount'))}
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input id="series-estimated" type="checkbox" className="accent-brand" checked={state.estimated} onChange={(e) => patch({ estimated: e.target.checked })} />
            {t('editor.estimated')}
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-category">{t('editor.category')}</Label>
            <NativeSelect id="series-category" value={state.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              <option value="">{t('editor.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">
            <CounterpartyField orgId={orgId} counterparties={counterparties} value={state.counterpartyId} onChange={(id) => patch({ counterpartyId: id })} />
          </div>
          <div className="sm:col-span-2">
            <TagsField orgId={orgId} tags={tags} value={state.tagIds} onChange={(ids) => patch({ tagIds: ids })} canCreate={can('data.write')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-description">{t('editor.description')}</Label>
            <Input id="series-description" value={state.description} maxLength={500} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-frequency">{t('editor.frequency')}</Label>
            <NativeSelect id="series-frequency" value={state.frequency} onChange={(e) => patch({ frequency: e.target.value as EditorState['frequency'] })}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`editor.freq.${f}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {state.frequency === 'weekly' ? (
            <div className="space-y-1.5">
              <Label htmlFor="series-weekday">{t('editor.weekday')}</Label>
              <NativeSelect id="series-weekday" value={state.weekday} onChange={(e) => patch({ weekday: e.target.value })}>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {formatWeekday(weekdayDate(d), locale, 'long')}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="series-day">{t('editor.dayOfMonth')}</Label>
              <Input id="series-day" inputMode="numeric" value={state.dayOfMonth} aria-invalid={errors.dayOfMonth} onChange={(e) => patch({ dayOfMonth: e.target.value })} />
              <p className={errors.dayOfMonth ? 'text-xs text-expense' : 'text-xs text-ink-muted'}>{errors.dayOfMonth ? t('editor.errors.dayOfMonth') : t('editor.dayHint')}</p>
            </div>
          )}
          {state.frequency === 'everyNMonths' && (
            <div className="space-y-1.5">
              <Label htmlFor="series-interval">{t('editor.interval')}</Label>
              <Input id="series-interval" inputMode="numeric" value={state.interval} aria-invalid={errors.interval} onChange={(e) => patch({ interval: e.target.value })} />
              {fieldError(errors.interval, t('editor.errors.interval'))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="series-start">{t('editor.startDate')}</Label>
            <DateField id="series-start" value={state.startDate} onChange={(day) => patch({ startDate: day })} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
            {fieldError(errors.startDate, t('editor.errors.startDate'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-end">{t('editor.endDate')}</Label>
            <DateField id="series-end" value={state.endDate} onChange={(day) => patch({ endDate: day })} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
            {fieldError(errors.endDate, t('editor.errors.endDate'))}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-weekend">{t('editor.weekendRule')}</Label>
            <NativeSelect id="series-weekend" value={state.weekendRule} onChange={(e) => patch({ weekendRule: e.target.value as EditorState['weekendRule'] })}>
              {WEEKEND_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`editor.weekend.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('editor.cancel')}
          </Button>
          <Button type="button" data-testid="series-save" disabled={busy} onClick={() => void save()}>
            {editing ? t('editor.save') : t('editor.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
