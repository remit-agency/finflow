'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FilterMultiSelect, type FilterOption } from '@/components/analytics/FilterMultiSelect'
import { TagDot } from '@/components/tags/TagDot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilters, type AnalyticsScope } from '@/lib/domain/analytics-filter/filter'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { MAX_FILTER_IDS, NO_TAG } from '@/lib/domain/journal/filter'
import { TX_TYPES, type TxType } from '@/lib/domain/ledger/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { useCategoryName } from '@/lib/i18n/useCategoryName'

type Field = 'kinds' | 'counterparties' | 'tags' | 'accounts'

// The payment types and the categories share one list, so their ids get a prefix there.
const TYPE = 't:'
const CATEGORY = 'c:'

/** A colour the person chose for an account or a category: data, so it stays inline. */
function ColorDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
}

/** Name order, case and Latin diacritics ignored (the key the tags and counterparties compare names by). */
function byName<T>(name: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const x = nameKeyText(name(a))
    const y = nameKeyText(name(b))
    return x < y ? -1 : x > y ? 1 : 0
  }
}

interface Props {
  /** `accounts` on the Balance: only «Рахунки» is shown. */
  scope: AnalyticsScope
  /** The filters in the address when the dialog opened. */
  value: AnalyticsFilters
  onApply: (next: AnalyticsFilters) => void
  onClose: () => void
}

/**
 * «Фільтри» of the reports (S10f, Finmap's dialog): «Види платежів і категорії», «Контрагенти», «Теги» (with «Без тегів»),
 * «Рахунки». The choice is a draft in this dialog (a tick shows at once); «Готово» hands it over, «Скинути фільтри» clears
 * the fields shown and applies, closing the dialog any other way drops the draft.
 */
export function AnalyticsFiltersDialog({ scope, value, onApply, onClose }: Props) {
  const t = useTranslations('analytics.filters')
  const tTypes = useTranslations('journal.filters')
  const tTags = useTranslations('settings.tags.picker')
  const categoryName = useCategoryName()
  const { orgId, accounts, incomeCategories, expenseCategories } = useShell()
  const operations = scope === 'operations'
  // Counterparties and tags are read only while the dialog is open, and never for the Balance.
  const { counterparties, loading: counterpartiesLoading } = useCounterparties(operations ? orgId : null)
  const { tags, loading: tagsLoading } = useTags(operations ? orgId : null)
  const [draft, setDraft] = useState<AnalyticsFilters>(value)
  const [openField, setOpenField] = useState<Field | null>(null)
  const set = (patch: Partial<AnalyticsFilters>) => setDraft((d) => ({ ...d, ...patch }))
  // One list open at a time.
  const field = (key: Field) => ({ open: openField === key, onOpenChange: (open: boolean) => setOpenField(open ? key : null) })

  const kindOptions = TX_TYPES.flatMap((type): FilterOption[] => {
    const categories = type === 'income' ? incomeCategories : type === 'expense' ? expenseCategories : []
    return [
      { id: `${TYPE}${type}`, label: tTypes(`type_${type}`), free: true },
      ...[...categories]
        .sort(byName(categoryName))
        .map((c): FilterOption => ({ id: `${CATEGORY}${c.id}`, label: categoryName(c), marker: <ColorDot color={c.color} />, nested: true })),
    ]
  })
  const kindValue = [...draft.types.map((x) => `${TYPE}${x}`), ...draft.categoryIds.map((x) => `${CATEGORY}${x}`)]
  const setKinds = (ids: string[]) =>
    set({
      types: ids.filter((id) => id.startsWith(TYPE)).map((id) => id.slice(TYPE.length) as TxType),
      categoryIds: ids.filter((id) => id.startsWith(CATEGORY)).map((id) => id.slice(CATEGORY.length)),
    })
  const counterpartyOptions = [...counterparties]
    .sort(byName((c) => c.name))
    .map((c): FilterOption => ({ id: c.id, label: c.name, muted: c.archived }))
  const tagOptions: FilterOption[] = [
    ...tags.map(
      (tag): FilterOption => ({
        id: tag.id,
        label: tag.name,
        marker: <TagDot color={tag.color} />,
        muted: tag.archived,
        note: tag.excludeFromAnalytics ? tTags('excluded') : undefined,
      }),
    ),
    { id: NO_TAG, label: t('tags.untagged') },
  ]
  const accountOptions = accounts.map((a): FilterOption => ({ id: a.id, label: a.name, marker: <ColorDot color={a.color} /> }))
  // «Скинути фільтри» clears what the dialog shows: everything on Cash Flow, P&L and the Calendar, the accounts on the Balance.
  const reset: AnalyticsFilters = operations ? EMPTY_ANALYTICS_FILTERS : { ...value, accountIds: [] }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* One column that may not grow to a long nowrap line: long names wrap inside it on a phone (as in TransferSuggestions). */}
      <DialogContent data-testid="analytics-filters" className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {operations && (
            <>
              <FilterMultiSelect
                label={t('kinds.label')}
                allLabel={t('kinds.all')}
                searchLabel={t('kinds.search')}
                options={kindOptions}
                value={kindValue}
                onChange={setKinds}
                full={draft.categoryIds.length >= MAX_FILTER_IDS}
                {...field('kinds')}
              />
              <FilterMultiSelect
                label={t('counterparties.label')}
                allLabel={t('counterparties.all')}
                searchLabel={t('counterparties.search')}
                options={counterpartyOptions}
                value={draft.counterpartyIds}
                onChange={(ids) => set({ counterpartyIds: ids })}
                full={draft.counterpartyIds.length >= MAX_FILTER_IDS}
                disabled={counterpartiesLoading}
                {...field('counterparties')}
              />
              <FilterMultiSelect
                label={t('tags.label')}
                allLabel={t('tags.all')}
                searchLabel={t('tags.search')}
                options={tagOptions}
                value={draft.tagIds}
                onChange={(ids) => set({ tagIds: ids })}
                full={draft.tagIds.length >= MAX_FILTER_IDS}
                disabled={tagsLoading}
                {...field('tags')}
              />
            </>
          )}
          <FilterMultiSelect
            label={t('accounts.label')}
            allLabel={t('accounts.all')}
            searchLabel={t('accounts.search')}
            options={accountOptions}
            value={draft.accountIds}
            onChange={(ids) => set({ accountIds: ids })}
            full={draft.accountIds.length >= MAX_FILTER_IDS}
            {...field('accounts')}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onApply(reset)}>
            {t('reset')}
          </Button>
          <Button type="button" onClick={() => onApply(draft)}>
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
