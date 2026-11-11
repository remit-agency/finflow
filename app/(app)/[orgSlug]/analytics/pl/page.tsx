'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ExcludedHint } from '@/components/analytics/AnalyticsFilters'
import { ReportToolbar } from '@/components/analytics/ReportToolbar'
import PLSummaryCharts from '@/components/charts/PLSummaryCharts'
import PLTable from '@/components/charts/PLTable'
import { ExcludedLine } from '@/components/reports/ExcludedLine'
import { ReconciliationBlock } from '@/components/reports/ReconciliationBlock'
import { ReportNotice, ReportSource } from '@/components/reports/ReportNotice'
import { downloadReport } from '@/lib/api/reports-client'
import type { ExportFormat } from '@/lib/domain/reports/types'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
import { usePLReport } from '@/lib/hooks/useReports'
import { useShell } from '@/lib/hooks/useShell'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { DEFAULT_REPORT_PERIOD, periodSlug, type PeriodSelection } from '@/lib/utils/period'
import { plRows, reportQueryOf } from '@/lib/utils/report-view'
import { todayUtcDay } from '@/lib/utils/today'

export default function PLPage() {
  const t = useTranslations('analytics')
  const tReports = useTranslations('reports')
  const noCategory = useTranslations('journal.list')('noCategory')
  const categoryName = useCategoryName()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  // Categories come from ShellProvider (one subscription): the names and the order of the rows.
  const { incomeCategories, expenseCategories } = useShell()
  const categories = useMemo(() => [...incomeCategories, ...expenseCategories], [incomeCategories, expenseCategories])
  const [period, setPeriod] = useState<PeriodSelection>(DEFAULT_REPORT_PERIOD)
  // Warsaw's date, read once per visit (presets resolve against it).
  const [now] = useState(() => todayUtcDay())

  // The figures come from the server (S12), by recognition date; the filters live in the address (S10f).
  const { filters, setFilters, categoryTypes } = useAnalyticsFilters('operations')
  const query = useMemo(() => (categoryTypes === undefined ? null : reportQueryOf(period, now, filters)), [categoryTypes, period, now, filters])
  const { view, refresh } = usePLReport(orgSlug, query)
  const report = view.status === 'ready' ? view.data : null
  const { monthKeys, rows } = useMemo(
    () => (report ? plRows(report, categories, categoryName, noCategory) : { monthKeys: [], rows: [] }),
    [report, categories, categoryName, noCategory],
  )

  const handleExport = (format: ExportFormat) => {
    if (query === null) return
    downloadReport(orgSlug, 'pl', format, query, `pl-${periodSlug(period)}.${format}`).catch(() => toast.error(tReports('exportFailed')))
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{t('pl.title')}</h1>
          <p className="text-sm text-ink-muted">{t('pl.subtitle')}</p>
        </div>
        <ReportToolbar period={period} onPeriodChange={setPeriod} filters={filters} onFiltersChange={setFilters} onExport={handleExport} />
        {report?.excludedCounted && <ExcludedHint />}
        {report && <ReportSource coverage={report.coverage} />}
      </div>

      {view.status === 'too_large' && <ReportNotice kind="too_large" cap={view.cap} />}
      {view.status === 'invalid' && <ReportNotice kind="invalid" />}
      {view.status === 'error' && <ReportNotice kind="error" onRetry={refresh} />}

      {report && rows.length > 0 && <PLSummaryCharts rows={rows} />}
      {view.status !== 'too_large' && view.status !== 'invalid' && view.status !== 'error' && <PLTable rows={rows} monthKeys={monthKeys} loading={view.status === 'loading'} />}

      {report && (
        <>
          <ExcludedLine excluded={report.excluded} currency={report.currency} testId="pl-excluded" />
          <ReconciliationBlock reconciliation={report.reconciliation} currency={report.currency} />
        </>
      )}
    </div>
  )
}
