'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CounterpartyPicker } from '@/components/counterparties/CounterpartyPicker'
import { TagPicker } from '@/components/tags/TagPicker'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { categoryTypeOf, splitByPatch, type BulkPatch } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { MAX_TX_TAGS, type Tag } from '@/lib/domain/tags/types'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import type { Category } from '@/types'
import type { BulkField } from './SelectionBar'

interface Props {
  field: BulkField
  rows: LedgerTransaction[]
  today: string
  incomeCategories: Category[]
  expenseCategories: Category[]
  counterparties: Counterparty[]
  /** The company's tags (S10t). */
  tags: Tag[]
  busy: boolean
  progress: { done: number; total: number } | null
  onApply: (patch: BulkPatch) => void
  onStop: () => void
  onClose: () => void
}

/** One field changed on every selected row; shows what will be skipped before anything is sent. */
export function BulkEditDialog({ field, rows, today, incomeCategories, expenseCategories, counterparties, tags, busy, progress, onApply, onStop, onClose }: Props) {
  const t = useTranslations('journal.bulk')
  const tForm = useTranslations('forms.transaction')
  const categoryName = useCategoryName()
  const [category, setCategory] = useState('')
  const [counterparty, setCounterparty] = useState<string | null>(null)
  // Nothing is applied until the person picks (the picker's «none» is the explicit «clear»).
  const [counterpartyChosen, setCounterpartyChosen] = useState(false)
  const [comment, setComment] = useState('')
  const [day, setDay] = useState(today)
  const [mode, setMode] = useState<'date' | 'period'>('date')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [addTags, setAddTags] = useState<string[]>([])
  const [removeTags, setRemoveTags] = useState<string[]>([])
  // Only a tag that some selected operation has can be taken off.
  const onRows = [...new Set(rows.flatMap((r) => r.tags))]

  const type = categoryTypeOf(rows)
  const categories = type === 'income' ? incomeCategories : type === 'expense' ? expenseCategories : []

  const patch = (): BulkPatch | null => {
    switch (field) {
      case 'category':
        if (!type || category === '') return null
        return { categoryId: category === '_none' ? null : category }
      case 'counterparty':
        return counterpartyChosen ? { counterpartyId: counterparty } : null
      case 'comment':
        return { description: comment.trim() === '' ? null : comment.trim() }
      case 'paymentDate':
        return day ? { paymentDate: day } : null
      case 'accrual':
        if (mode === 'date') return day ? { accrual: { mode: 'date', date: day } } : null
        return from && to && from <= to ? { accrual: { mode: 'period', from, to } } : null
      case 'addTags':
        return addTags.length > 0 ? { addTagIds: addTags } : null
      case 'removeTags':
        return removeTags.length > 0 ? { removeTagIds: removeTags } : null
    }
  }
  const current = patch()
  const preview = current ? splitByPatch(rows, current, today) : null
  const skippedTransfers = preview?.skipped.filter((s) => s.reason === 'transfer').length ?? 0
  const skippedFuture = preview?.skipped.filter((s) => s.reason === 'future_actual').length ?? 0
  const dateProps = { placeholder: t('datePlaceholder'), calendarLabel: t('openCalendar') }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`title_${field}`)}</DialogTitle>
          <DialogDescription>{t('selected', { count: rows.length })}</DialogDescription>
        </DialogHeader>

        {field === 'category' &&
          (type ? (
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('title_category')} className="border-line">
              <option value="">{t('chooseCategory')}</option>
              <option value="_none">{t('noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="text-sm text-ink-muted">{t('categoryMixed')}</p>
          ))}

        {field === 'counterparty' && (
          <CounterpartyPicker
            counterparties={counterparties.filter((c) => !c.archived)}
            value={counterparty}
            onChange={(id) => {
              setCounterparty(id)
              setCounterpartyChosen(true)
            }}
          />
        )}

        {field === 'comment' && (
          <div className="space-y-1.5">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} aria-label={t('title_comment')} placeholder={t('commentPlaceholder')} />
            {comment.trim() === '' && <p className="text-sm text-ink-muted">{t('commentClearsHint')}</p>}
          </div>
        )}

        {field === 'paymentDate' && (
          <div className="space-y-1">
            <Label htmlFor="bulk-payment-date" className="sr-only">
              {t('title_paymentDate')}
            </Label>
            <DateField id="bulk-payment-date" value={day} onChange={setDay} {...dateProps} />
          </div>
        )}

        {field === 'accrual' && (
          <div className="space-y-3">
            <Segmented
              label={t('accrualMode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'date', label: t('accrualDate') },
                { value: 'period', label: t('accrualPeriod') },
              ]}
            />
            {mode === 'date' ? (
              <div className="space-y-1">
                <Label htmlFor="bulk-accrual-date" className="sr-only">
                  {t('accrualDate')}
                </Label>
                <DateField id="bulk-accrual-date" value={day} onChange={setDay} {...dateProps} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bulk-accrual-from" className="sr-only">
                    {tForm('accrualFrom')}
                  </Label>
                  <DateField id="bulk-accrual-from" value={from} onChange={setFrom} {...dateProps} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulk-accrual-to" className="sr-only">
                    {tForm('accrualTo')}
                  </Label>
                  <DateField id="bulk-accrual-to" value={to} onChange={setTo} {...dateProps} />
                </div>
              </div>
            )}
          </div>
        )}

        {field === 'addTags' && (
          <div className="space-y-1.5">
            <TagPicker tags={tags} value={addTags} onChange={setAddTags} max={MAX_TX_TAGS} />
            <p className="text-sm text-ink-muted">{t('tagsAddHint')}</p>
          </div>
        )}

        {field === 'removeTags' &&
          (onRows.length > 0 ? (
            <TagPicker tags={tags} value={removeTags} onChange={setRemoveTags} max={MAX_TX_TAGS} includeArchived only={onRows} />
          ) : (
            <p className="text-sm text-ink-muted">{t('tagsNone')}</p>
          ))}

        {preview && (skippedTransfers > 0 || skippedFuture > 0) && (
          <p className="text-sm text-ink-muted">
            {t('preview', { apply: preview.apply.length, skipped: preview.skipped.length })}{' '}
            {skippedTransfers > 0 && t('skipTransfer', { count: skippedTransfers })} {skippedFuture > 0 && t('skipFuture', { count: skippedFuture })}
          </p>
        )}

        {progress && (
          <p role="status" className="text-sm text-ink-muted tabular-nums">
            {t('progress', { done: progress.done, total: progress.total })}
          </p>
        )}

        <DialogFooter>
          {busy ? (
            <Button type="button" variant="outline" onClick={onStop}>
              {t('stop')}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
          )}
          <Button type="button" disabled={busy || !current || !preview || preview.apply.length === 0} onClick={() => current && onApply(current)}>
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
