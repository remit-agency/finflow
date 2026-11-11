'use client'

import { useTranslations } from 'next-intl'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { Totals } from '@/lib/domain/reports/types'
import { useFormatters } from '@/lib/i18n/useFormatters'

/** «Виключено з аналітики» (S12, the owner's 2026-10-29 requirement): what the report left out; nothing when a tag counts them in. */
export function ExcludedLine({ excluded, currency, testId }: { excluded: Totals | null; currency: string; testId: string }) {
  const t = useTranslations('reports.excluded')
  const { money } = useFormatters()
  if (excluded === null || (excluded.incomeBase === 0 && excluded.expenseBase === 0)) return null
  return (
    <div data-testid={testId} className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-line bg-surface px-6 py-4 text-sm">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{t('title')}</p>
        <p className="text-xs text-ink-muted">{t('hint')}</p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        {excluded.incomeBase !== 0 && <p data-testid={`${testId}-income`} className="text-income">+{money(fromMinor(excluded.incomeBase), currency)}</p>}
        {excluded.expenseBase !== 0 && <p data-testid={`${testId}-expense`} className="text-expense">−{money(fromMinor(excluded.expenseBase), currency)}</p>}
      </div>
    </div>
  )
}
