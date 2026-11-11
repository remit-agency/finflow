'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { fromMinor } from '@/lib/domain/ledger/money'
import { categoryTreeRows } from '@/lib/domain/reports/categories'
import type { CategoryLine } from '@/lib/domain/reports/types'
import { useShell } from '@/lib/hooks/useShell'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'

/** «За категоріями» of Cash Flow (S12): each type's tree, a parent with the sum of its subcategories, «Без категорії» last. */
export function CategoryBreakdown({ lines, currency }: { lines: CategoryLine[]; currency: string }) {
  const t = useTranslations('reports.byCategory')
  const noCategory = useTranslations('journal.list')('noCategory')
  const categoryName = useCategoryName()
  const { incomeCategories, expenseCategories } = useShell()
  const { money } = useFormatters()
  const categories = useMemo(() => [...incomeCategories, ...expenseCategories], [incomeCategories, expenseCategories])
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const rows = useMemo(() => categoryTreeRows(lines, categories), [lines, categories])
  return (
    <section aria-labelledby="cf-categories-title" className="overflow-hidden rounded-panel border border-line bg-surface">
      <h2 id="cf-categories-title" className="border-b border-line px-6 py-4 text-sm font-semibold text-ink">{t('title')}</h2>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const category = byId.get(r.row)
            return (
              <li
                key={`${r.type}|${r.row}`}
                data-testid="cf-category-row"
                data-level={r.level}
                className="flex items-baseline justify-between gap-4 py-2.5 pr-6 text-sm"
                style={{ paddingLeft: `${24 + r.level * 20}px` }}
              >
                <span className={cn('min-w-0 truncate', r.level === 0 ? 'font-medium text-ink' : 'text-ink-muted')}>{category ? categoryName(category) : noCategory}</span>
                <span className={cn('shrink-0 tabular-nums', r.type === 'income' ? 'text-income' : 'text-expense')}>
                  {r.type === 'income' ? '+' : '−'}
                  {money(fromMinor(r.amountBase), currency)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
