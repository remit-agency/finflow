'use client'

import { useTranslations } from 'next-intl'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { CurrencyTotal, RecurringOverview } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'

/** «Прострочено: N» and «Найближчі 7 днів» (income and expense apart, per currency) over the page (S11). */
export function RecurringStrip({ overview }: { overview: RecurringOverview }) {
  const t = useTranslations('recurring.strip')
  const { money } = useFormatters()
  const sums = (list: CurrencyTotal[]): string => (list.length === 0 ? '—' : list.map((s) => money(fromMinor(s.amountMinor), s.currency)).join(' · '))
  const overdue = overview.overdueCount > 0
  return (
    <section data-testid="recurring-strip" className="grid gap-3 sm:grid-cols-3">
      <div className={cn('rounded-panel border border-line px-4 py-3', overdue ? 'bg-expense-soft text-expense' : 'bg-surface text-ink-muted')}>
        <p data-testid="recurring-overdue" className="text-sm font-semibold">
          {overdue ? t('overdue', { count: overview.overdueCount }) : t('overdueNone')}
        </p>
      </div>
      <div className="rounded-panel border border-line bg-surface px-4 py-3 sm:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('soon')}</p>
        <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">{t('income')}</dt>
            <dd data-testid="recurring-soon-income" className="text-right font-semibold tabular-nums text-income">{sums(overview.soon.income)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">{t('expense')}</dt>
            <dd data-testid="recurring-soon-expense" className="text-right font-semibold tabular-nums text-expense">{sums(overview.soon.expense)}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
