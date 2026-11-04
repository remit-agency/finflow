'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FilterMultiSelect, type FilterOption } from '@/components/analytics/FilterMultiSelect'
import { TagDot } from '@/components/tags/TagDot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  buildKindTree,
  kindState,
  noCategoryId,
  parseNoCategoryId,
  rootState,
  toggleKind,
  type KindGroupType,
  type KindNode,
  type KindRef,
} from '@/lib/domain/analytics-filter/kinds'
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilters, type AnalyticsScope } from '@/lib/domain/analytics-filter/filter'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { MAX_FILTER_IDS, NO_TAG } from '@/lib/domain/journal/filter'
import type { Category } from '@/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { useCategoryName } from '@/lib/i18n/useCategoryName'

type Field = 'kinds' | 'counterparties' | 'tags' | 'accounts'

/** The tree's row ids: categories keep their own id; the others are prefixed so no two rows share one. */
const GROUP_ROW = (type: KindGroupType): string => `group:${type}`
const TRANSFER_ROW = 'type:transfer'

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
 * «Фільтри» of the reports (S10f, Finmap's dialog): «Види платежів і категорії» (one tree: «Усі види платежів і категорії», the
 * groups «Усі надходження» and «Усі витрати» with their categories and «Без категорії …», «Переказ»), «Контрагенти», «Теги»
 * (with «Без тегів»), «Рахунки». The choice is a draft in this dialog (a tick shows at once); «Готово» hands it over,
 * «Скинути фільтри» clears the fields shown and applies, closing the dialog any other way drops the draft.
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
  // The tree's open rows are the ones not listed here: everything opens at first.
  const [closedRows, setClosedRows] = useState<ReadonlySet<string>>(() => new Set())
  const set = (patch: Partial<AnalyticsFilters>) => setDraft((d) => ({ ...d, ...patch }))
  // One list open at a time.
  const field = (key: Field) => ({ open: openField === key, onOpenChange: (open: boolean) => setOpenField(open ? key : null) })

  const tree = useMemo(
    () => buildKindTree([...incomeCategories, ...expenseCategories], byName(categoryName)),
    [incomeCategories, expenseCategories, categoryName],
  )
  const kinds = { types: draft.types, categoryIds: draft.categoryIds }
  const typeName = (type: KindGroupType | 'transfer'): string =>
    type === 'transfer' ? tTypes('type_transfer') : t(type === 'income' ? 'kinds.groupIncome' : 'kinds.groupExpense')
  const uncategorisedName = (type: KindGroupType): string => t(type === 'income' ? 'kinds.uncategorisedIncome' : 'kinds.uncategorisedExpense')

  // The rows of the tree, in the order the list shows them; `refs` maps a row back to what a tick on it means.
  const refs = new Map<string, KindRef>()
  const kindOptions: FilterOption[] = []
  // The levels: the root (the list's first row) is 0, the groups and transfers 1, the rows under a group 2 and deeper.
  const visit = (node: KindNode<Category>, level: number, hidden: boolean): void => {
    const id = node.category.id
    const ref: KindRef = { kind: 'category', id }
    refs.set(id, ref)
    const open = node.children.length > 0 ? !closedRows.has(id) : undefined
    kindOptions.push({
      id,
      label: categoryName(node.category),
      marker: <ColorDot color={node.category.color} />,
      state: kindState(kinds, tree, ref),
      level,
      expanded: open,
      collapsed: hidden,
    })
    for (const child of node.children) visit(child, level + 1, hidden || open === false)
  }
  for (const type of ['income', 'expense'] as const) {
    const groupId = GROUP_ROW(type)
    const open = !closedRows.has(groupId)
    const group: KindRef = { kind: 'group', type }
    const uncategorised: KindRef = { kind: 'uncategorised', type }
    refs.set(groupId, group)
    refs.set(noCategoryId(type), uncategorised)
    kindOptions.push({ id: groupId, label: typeName(type), state: kindState(kinds, tree, group), level: 1, expanded: open, free: true })
    for (const root of tree[type].roots) visit(root, 2, !open)
    kindOptions.push({ id: noCategoryId(type), label: uncategorisedName(type), state: kindState(kinds, tree, uncategorised), level: 2, collapsed: !open })
  }
  const transfer: KindRef = { kind: 'transfer' }
  refs.set(TRANSFER_ROW, transfer)
  kindOptions.push({ id: TRANSFER_ROW, label: typeName('transfer'), state: kindState(kinds, tree, transfer), level: 1, free: true })

  // The field's closed text: nothing restricted, one group, one category, one uncategorised row, or how many are chosen.
  const kindSummary = (() => {
    const { types, categoryIds } = draft
    if (types.length === 0 && categoryIds.length === 0) return { text: t('kinds.all'), active: false }
    if (categoryIds.length === 0 && types.length === 1) return { text: typeName(types[0]), active: true }
    if (types.length === 0 && categoryIds.length === 1) {
      const only = categoryIds[0]
      const uncategorised = parseNoCategoryId(only)
      if (uncategorised) return { text: uncategorisedName(uncategorised), active: true }
      const node = tree.nodes.get(only)
      if (node) return { text: categoryName(node.category), active: true }
    }
    return { text: t('kinds.summary', { count: types.length + categoryIds.length }), active: true }
  })()

  const onKindToggle = (id: string) => {
    const ref = refs.get(id)
    if (!ref) return
    const result = toggleKind(kinds, tree, ref, kindState(kinds, tree, ref) !== 'checked')
    // A tick the address cannot keep (more than 30 ids) is refused; the list says so.
    if (result.ok) set(result.selection)
  }
  const onKindExpand = (id: string, expanded: boolean) =>
    setClosedRows((closed) => {
      const next = new Set(closed)
      if (expanded) next.delete(id)
      else next.add(id)
      return next
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
                summary={kindSummary}
                allLabel={t('kinds.root')}
                allState={rootState(kinds)}
                searchLabel={t('kinds.search')}
                options={kindOptions}
                value={[]}
                onChange={() => set({ types: [], categoryIds: [] })}
                onRowToggle={onKindToggle}
                onExpand={onKindExpand}
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
