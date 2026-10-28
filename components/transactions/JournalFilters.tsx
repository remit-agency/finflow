// components/transactions/JournalFilters.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { PeriodSelect } from '@/components/analytics/PeriodSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { EMPTY_FILTERS, hasActiveFilters, type JournalFilters } from '@/lib/domain/journal/filter'
import { toMinor, fromMinor } from '@/lib/domain/ledger/money'
import type { TxType } from '@/lib/domain/ledger/types'
import { useIsPhone } from '@/lib/hooks/useIsPhone'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { cn } from '@/lib/utils'
import { JOURNAL_PERIOD_PRESETS, type JournalView } from '@/lib/utils/journal-url'
import type { Account, Category } from '@/types'

const FIELD_CLASS = 'h-9 rounded-control border-line bg-surface'
const DEBOUNCE_MS = 300

interface Props {
  view: JournalView
  onChange: (view: JournalView) => void
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  counterparties: Counterparty[]
  /** Shown at the end of the toolbar row (the selected-account chip, the export button). */
  accessory?: ReactNode
}

/** The amount a typed text stands for, in minor units; undefined for an empty or invalid text. */
function parseAmountMinor(raw: string): number | undefined {
  const n = parseFloat(raw.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? toMinor(n) : undefined
}

/**
 * A text field whose value lives in the address, applied after a pause. The person's draft is shown while the
 * address has not taken it over yet (`from` is what the address held when the draft was typed) and for as long as
 * the address holds the same value; once something else changes the address (clear, back), the address wins.
 * `apply` runs from a timer, so it is read through a ref kept current by an effect and never closes over the
 * view of the keystroke.
 */
function useDraftField(external: string, same: (draft: string) => boolean, apply: (draft: string) => void) {
  const [draft, setDraft] = useState<{ from: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const applyRef = useRef(apply)
  useEffect(() => {
    applyRef.current = apply
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  const type = (text: string) => {
    setDraft({ from: external, text })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => applyRef.current(text), DEBOUNCE_MS)
  }
  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    setDraft(null)
  }, [])
  const shown = draft && (draft.from === external || same(draft.text)) ? draft.text : external
  return { shown, type, cancel }
}

const TYPES: TxType[] = ['income', 'expense', 'transfer']

export function JournalFiltersBar({ view, onChange, accounts, incomeCategories, expenseCategories, counterparties, accessory }: Props) {
  const t = useTranslations('journal.filters')
  const categoryName = useCategoryName()
  // The phone has room for about half a row per select: the short «all» labels keep them from clipping.
  const phone = useIsPhone()
  const [showExtra, setShowExtra] = useState(false)
  const { filters } = view
  // Every change builds on the view as last REQUESTED, not on the one last rendered: the address updates a moment
  // after `onChange`, and a text field's timer (or a second click) inside that moment must not undo the first change
  // (nor must the account picked in the sidebar or «Очистити» be reverted by a view from the keystroke). The ref
  // follows the props whenever the address really changes.
  const viewRef = useRef(view)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    viewRef.current = { filters, period: view.period }
  }, [filters, view.period])
  const apply = (next: JournalView) => {
    viewRef.current = next
    onChangeRef.current(next)
  }
  const set = (patch: Partial<JournalFilters>) => apply({ ...viewRef.current, filters: { ...viewRef.current.filters, ...patch } })

  const search = useDraftField(
    filters.q ?? '',
    (draft) => draft.trim() === (filters.q ?? ''),
    (draft) => set({ q: draft.trim() || undefined }),
  )
  const minField = useDraftField(
    filters.minMinor === undefined ? '' : String(fromMinor(filters.minMinor)),
    (draft) => parseAmountMinor(draft) === filters.minMinor,
    (draft) => set({ minMinor: parseAmountMinor(draft) }),
  )
  const maxField = useDraftField(
    filters.maxMinor === undefined ? '' : String(fromMinor(filters.maxMinor)),
    (draft) => parseAmountMinor(draft) === filters.maxMinor,
    (draft) => set({ maxMinor: parseAmountMinor(draft) }),
  )

  const active = hasActiveFilters(filters)
  // «Очистити» clears everything the bar shows, the account too (the page passes that on to the sidebar selection).
  const clear = () => {
    search.cancel()
    minField.cancel()
    maxField.cancel()
    apply({ filters: { ...EMPTY_FILTERS }, period: { preset: 'allTime' } })
  }

  const toggleType = (type: TxType) =>
    set({ types: viewRef.current.filters.types.includes(type) ? viewRef.current.filters.types.filter((x) => x !== type) : [...viewRef.current.filters.types, type] })
  const toggleCounterparty = (id: string) =>
    set({
      counterpartyIds: viewRef.current.filters.counterpartyIds.includes(id)
        ? viewRef.current.filters.counterpartyIds.filter((x) => x !== id)
        : [...viewRef.current.filters.counterpartyIds, id],
    })
  const allCategories = [...incomeCategories, ...expenseCategories]
  const selectedCategory = filters.categoryIds[0] ?? '_all'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[260px] sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={search.shown}
            onChange={(e) => search.type(e.target.value)}
            placeholder={phone ? t('searchPlaceholderShort') : t('searchPlaceholder')}
            aria-label={t('search')}
            className={cn(FIELD_CLASS, 'pl-9')}
          />
        </div>

        <PeriodSelect value={view.period} presets={JOURNAL_PERIOD_PRESETS} onChange={(period) => apply({ ...viewRef.current, period })} />

        {/* Below sm the two selects take a row of their own (after the period, filter and export buttons); from sm up the wrapper vanishes and they sit in the toolbar row. */}
        <div className="order-last flex w-full gap-2 sm:contents">
          <NativeSelect
            value={filters.accountId ?? '_all'}
            onChange={(e) => set({ accountId: e.target.value === '_all' ? undefined : e.target.value })}
            aria-label={t('account')}
            wrapperClassName="min-w-0 flex-1 sm:flex-none"
            className="border-line sm:min-w-[160px]"
          >
            <option value="_all">{phone ? t('allAccountsShort') : t('allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>

          <NativeSelect
            value={selectedCategory}
            onChange={(e) => set({ categoryIds: e.target.value === '_all' ? [] : [e.target.value] })}
            aria-label={t('category')}
            wrapperClassName="min-w-0 flex-1 sm:flex-none"
            className="border-line sm:min-w-[160px]"
          >
            <option value="_all">{phone ? t('allCategoriesShort') : t('allCategories')}</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>{categoryName(c)}</option>
            ))}
          </NativeSelect>
        </div>

        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => setShowExtra((v) => !v)}
          aria-label={t('more')}
          aria-pressed={showExtra}
          className={cn('border-line bg-surface text-ink-muted hover:bg-canvas', showExtra && 'border-brand bg-brand-soft text-brand-soft-foreground')}
        >
          <SlidersHorizontal />
        </Button>

        {active && (
          <Button variant="ghost" size="lg" onClick={clear} className="gap-1 text-ink-muted">
            <X className="size-3.5" />
            {t('clear')}
          </Button>
        )}

        {accessory}
      </div>

      {showExtra && (
        <div className="space-y-3 rounded-field border border-line bg-canvas p-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="sr-only">{t('type')}</legend>
              {TYPES.map((type) => (
                <label key={type} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-brand" checked={filters.types.includes(type)} onChange={() => toggleType(type)} />
                  <span>{t(`type_${type}`)}</span>
                </label>
              ))}
            </fieldset>

            <Segmented
              label={t('status')}
              className="w-auto"
              value={filters.status ?? 'all'}
              onChange={(value) => set({ status: value === 'all' ? undefined : value })}
              options={[
                { value: 'all', label: t('statusAll') },
                { value: 'actual', label: t('statusActual') },
                { value: 'planned', label: t('statusPlanned') },
              ]}
            />

            <Segmented
              label={t('basis')}
              className="w-auto"
              value={filters.basis}
              onChange={(basis) => set({ basis })}
              options={[
                { value: 'payment', label: t('basisPayment') },
                { value: 'accrual', label: t('basisAccrual') },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              {t('amountFrom')}
              <Input
                type="number"
                min={0}
                step="0.01"
                className={cn(FIELD_CLASS, 'w-[110px] tabular-nums')}
                value={minField.shown}
                onChange={(e) => minField.type(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              {t('amountTo')}
              <Input
                type="number"
                min={0}
                step="0.01"
                className={cn(FIELD_CLASS, 'w-[110px] tabular-nums')}
                value={maxField.shown}
                onChange={(e) => maxField.type(e.target.value)}
              />
            </label>
          </div>

          {counterparties.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm text-ink-muted">{t('counterparties')}</legend>
              <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                {counterparties.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-brand" checked={filters.counterpartyIds.includes(c.id)} onChange={() => toggleCounterparty(c.id)} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}
