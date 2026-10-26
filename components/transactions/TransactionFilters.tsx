'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { cn } from '@/lib/utils'
import type { Account, Category } from '@/types'
import type { TransactionFilters } from '@/lib/firebase/transactions'

const FIELD_CLASS = 'h-9 rounded-control border-line bg-surface'

interface TransactionFiltersProps {
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  /** Shown at the end of the toolbar row (the journal puts the selected-account chip there). */
  accessory?: ReactNode
}

export function TransactionFiltersBar({
  accounts,
  incomeCategories,
  expenseCategories,
  filters,
  onChange,
  accessory,
}: TransactionFiltersProps) {
  const t = useTranslations('journal.filters')
  const categoryName = useCategoryName()
  const [showExtra, setShowExtra] = useState(false)
  const allCategories = [...incomeCategories, ...expenseCategories]

  const hasActive =
    filters.search ||
    filters.accountId ||
    filters.categoryId ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.amountMin !== undefined ||
    filters.amountMax !== undefined

  const clear = () =>
    onChange({
      search: undefined,
      accountId: undefined,
      categoryId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      amountMin: undefined,
      amountMax: undefined,
    })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        {/* A row of its own on a phone; the two selects and the filter button share the next one. */}
        <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={filters.search ?? ''}
            onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className={cn(FIELD_CLASS, 'pl-9')}
          />
        </div>

        {/* Account filter */}
        <NativeSelect
          value={filters.accountId ?? '_all'}
          onChange={(e) => onChange({ ...filters, accountId: e.target.value === '_all' ? undefined : e.target.value })}
          aria-label={t('account')}
          wrapperClassName="min-w-0 flex-1 sm:flex-none"
          className="border-line sm:min-w-[160px]"
        >
          <option value="_all">{t('allAccounts')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </NativeSelect>

        {/* Category filter */}
        <NativeSelect
          value={filters.categoryId ?? '_all'}
          onChange={(e) => onChange({ ...filters, categoryId: e.target.value === '_all' ? undefined : e.target.value })}
          aria-label={t('category')}
          wrapperClassName="min-w-0 flex-1 sm:flex-none"
          className="border-line sm:min-w-[160px]"
        >
          <option value="_all">{t('allCategories')}</option>
          {allCategories.map((c) => (
            <option key={c.id} value={c.id}>{categoryName(c)}</option>
          ))}
        </NativeSelect>

        {/* More filters toggle */}
        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => setShowExtra((v) => !v)}
          aria-label={t('more')}
          aria-pressed={showExtra}
          className={cn(
            'border-line bg-surface text-ink-muted hover:bg-canvas',
            showExtra && 'border-brand bg-brand-soft text-brand-soft-foreground',
          )}
        >
          <SlidersHorizontal />
        </Button>

        {/* Clear */}
        {hasActive && (
          <Button variant="ghost" size="lg" onClick={clear} className="gap-1 text-ink-muted">
            <X className="size-3.5" />
            {t('clear')}
          </Button>
        )}

        {accessory}
      </div>

      {showExtra && (
        <div className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-canvas p-3">
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-ink-muted">{t('dateFrom')}</label>
            <Input
              type="date"
              className={cn(FIELD_CLASS, 'w-[150px]')}
              value={filters.dateFrom ? filters.dateFrom.toISOString().split('T')[0] : ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  dateFrom: e.target.value ? new Date(e.target.value) : undefined,
                })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-ink-muted">{t('dateTo')}</label>
            <Input
              type="date"
              className={cn(FIELD_CLASS, 'w-[150px]')}
              value={filters.dateTo ? filters.dateTo.toISOString().split('T')[0] : ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  dateTo: e.target.value ? new Date(e.target.value) : undefined,
                })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-ink-muted">{t('amountFrom')}</label>
            <Input
              type="number"
              className={cn(FIELD_CLASS, 'w-[110px] tabular-nums')}
              placeholder="0"
              value={filters.amountMin ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  amountMin: e.target.value ? parseFloat(e.target.value) : undefined,
                })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-ink-muted">{t('amountTo')}</label>
            <Input
              type="number"
              className={cn(FIELD_CLASS, 'w-[110px] tabular-nums')}
              placeholder="∞"
              value={filters.amountMax ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  amountMax: e.target.value ? parseFloat(e.target.value) : undefined,
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
