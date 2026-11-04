'use client'

import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { AnalyticsFiltersButton } from '@/components/analytics/AnalyticsFilters'
import { PeriodSelect } from '@/components/analytics/PeriodSelect'
import type { AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import type { PeriodSelection } from '@/lib/utils/period'

interface ReportToolbarProps {
  period: PeriodSelection
  onPeriodChange: (value: PeriodSelection) => void
  /** The report filters from the address (S10f). */
  filters: AnalyticsFilters
  onFiltersChange: (next: AnalyticsFilters) => void
  onExport: () => void
}

/**
 * The row of pills under a report's title (Finmap's report toolbar structure): the period filter first, then «Фільтри»
 * (S10f), then the actions as square icon pills (CSV export).
 */
export function ReportToolbar({ period, onPeriodChange, filters, onFiltersChange, onExport }: ReportToolbarProps) {
  const t = useTranslations('analytics')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodSelect value={period} onChange={onPeriodChange} />
      <AnalyticsFiltersButton scope="operations" value={filters} onChange={onFiltersChange} />
      <button
        type="button"
        onClick={onExport}
        aria-label={t('exportCsv')}
        title={t('exportCsv')}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-field bg-canvas text-ink transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground sm:size-10"
      >
        <Download aria-hidden className="size-4.5" />
      </button>
    </div>
  )
}
