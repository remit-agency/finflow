// components/transactions/JournalFilters.tsx
'use client'

import { useRef, useState, type ReactNode } from 'react'
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
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { cn } from '@/lib/utils'
import { JOURNAL_PERIOD_PRESETS, type JournalView } from '@/lib/utils/journal-url'
import type { Account, Category } from '@/types'

const FIELD_CLASS = 'h-9 rounded-control border-line bg-surface'
const SEARCH_DEBOUNCE_MS = 300

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

const TYPES: TxType[] = ['income', 'expense', 'transfer']

export function JournalFiltersBar({ view, onChange, accounts, incomeCategories, expenseCategories, counterparties, accessory }: Props) {
  const t = useTranslations('journal.filters')
  const categoryName = useCategoryName()
  const [showExtra, setShowExtra] = useState(false)
  const { filters } = view
  const set = (patch: Partial<JournalFilters>) => onChange({ ...view, filters: { ...filters, ...patch } })

  // The text is applied after a pause; the field keeps what is typed meanwhile.
  const [draft, setDraft] = useState<{ from: string | undefined; text: string }>({ from: filters.q, text: filters.q ?? '' })
  const text = draft.from === filters.q ? draft.text : (filters.q ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const typeSearch = (value: string) => {
    setDraft({ from: filters.q, text: value })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => set({ q: value.trim() || undefined }), SEARCH_DEBOUNCE_MS)
  }

  const active = hasActiveFilters(filters)
  const clear = () => onChange({ filters: { ...EMPTY_FILTERS, accountId: filters.accountId }, period: { preset: 'allTime' } })

  const toggleType = (type: TxType) =>
    set({ types: filters.types.includes(type) ? filters.types.filter((x) => x !== type) : [...filters.types, type] })
  const toggleCounterparty = (id: string) =>
    set({ counterpartyIds: filters.counterpartyIds.includes(id) ? filters.counterpartyIds.filter((x) => x !== id) : [...filters.counterpartyIds, id] })
  const amountField = (key: 'minMinor' | 'maxMinor', raw: string) => {
    const n = parseFloat(raw.replace(',', '.'))
    set({ [key]: Number.isFinite(n) && n >= 0 ? toMinor(n) : undefined })
  }
  const allCategories = [...incomeCategories, ...expenseCategories]
  const selectedCategory = filters.categoryIds[0] ?? '_all'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[260px] sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={text}
            onChange={(e) => typeSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className={cn(FIELD_CLASS, 'pl-9')}
          />
        </div>

        <PeriodSelect value={view.period} presets={JOURNAL_PERIOD_PRESETS} onChange={(period) => onChange({ ...view, period })} />

        <NativeSelect
          value={filters.accountId ?? '_all'}
          onChange={(e) => set({ accountId: e.target.value === '_all' ? undefined : e.target.value })}
          aria-label={t('account')}
          wrapperClassName="min-w-0 flex-1 sm:flex-none"
          className="border-line sm:min-w-[160px]"
        >
          <option value="_all">{t('allAccounts')}</option>
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
          <option value="_all">{t('allCategories')}</option>
          {allCategories.map((c) => (
            <option key={c.id} value={c.id}>{categoryName(c)}</option>
          ))}
        </NativeSelect>

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
                value={filters.minMinor === undefined ? '' : fromMinor(filters.minMinor)}
                onChange={(e) => amountField('minMinor', e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              {t('amountTo')}
              <Input
                type="number"
                min={0}
                step="0.01"
                className={cn(FIELD_CLASS, 'w-[110px] tabular-nums')}
                value={filters.maxMinor === undefined ? '' : fromMinor(filters.maxMinor)}
                onChange={(e) => amountField('maxMinor', e.target.value)}
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
