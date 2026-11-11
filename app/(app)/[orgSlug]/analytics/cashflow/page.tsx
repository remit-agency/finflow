'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ExcludedHint } from '@/components/analytics/AnalyticsFilters'
import { ReportToolbar } from '@/components/analytics/ReportToolbar'
import CashFlowChart from '@/components/charts/CashFlowChart'
import { CashFlowAccounts } from '@/components/reports/CashFlowAccounts'
import { CategoryBreakdown } from '@/components/reports/CategoryBreakdown'
import { ExcludedLine } from '@/components/reports/ExcludedLine'
import { ReconciliationBlock } from '@/components/reports/ReconciliationBlock'
import { ReportNotice, ReportSource } from '@/components/reports/ReportNotice'
import { downloadReport } from '@/lib/api/reports-client'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { ExportFormat } from '@/lib/domain/reports/types'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
import { useCashFlowReport } from '@/lib/hooks/useReports'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { DEFAULT_REPORT_PERIOD, periodSlug, type PeriodSelection } from '@/lib/utils/period'
import { cashFlowBuckets, reportQueryOf } from '@/lib/utils/report-view'
import { todayUtcDay } from '@/lib/utils/today'

export default function CashFlowPage() {
  const t = useTranslations('analytics')
  const tCharts = useTranslations('charts')
  const tSections = useTranslations('shell.analyticsSections')
  const tReports = useTranslations('reports')
  const { locale, number } = useFormatters()
  const formatNum = (n: number) => number(n, { maximumFractionDigits: 0 })
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { can } = useShell()
  const [period, setPeriod] = useState<PeriodSelection>(DEFAULT_REPORT_PERIOD)
  // Warsaw's date, read once per visit (presets resolve against it).
  const [now] = useState(() => todayUtcDay())

  // The report filters live in the address (S10f); the categories decide their normal form, so the server is asked once
  // they are known. The figures come from the server (S12): this page no longer reads the company's operations.
  const { filters, setFilters, categoryTypes } = useAnalyticsFilters('operations')
  const query = useMemo(() => (categoryTypes === undefined ? null : reportQueryOf(period, now, filters)), [categoryTypes, period, now, filters])
  const { view, refresh } = useCashFlowReport(orgSlug, query)
  const report = view.status === 'ready' ? view.data : null
  const buckets = useMemo(() => (report ? cashFlowBuckets(report, locale) : []), [report, locale])
  const loading = view.status === 'loading'
  const unitLabel = report?.granularity === 'day' ? t('columns.day') : t('columns.month')

  const handleExport = (format: ExportFormat) => {
    if (query === null) return
    downloadReport(orgSlug, 'cashflow', format, query, `cashflow-${periodSlug(period)}.${format}`).catch(() => toast.error(tReports('exportFailed')))
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{tSections('cashflow')}</h1>
          <p className="text-sm text-ink-muted">{t('cashflow.subtitle')}</p>
        </div>
        <ReportToolbar period={period} onPeriodChange={setPeriod} filters={filters} onFiltersChange={setFilters} onExport={handleExport} />
        {report?.excludedCounted && <ExcludedHint />}
        {report && <ReportSource coverage={report.coverage} />}
      </div>

      {view.status === 'too_large' && <ReportNotice kind="too_large" cap={view.cap} />}
      {view.status === 'invalid' && <ReportNotice kind="invalid" />}
      {view.status === 'error' && <ReportNotice kind="error" onRetry={refresh} />}

      {report && buckets.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { id: 'income', label: t('cashflow.totalIncome'), value: fromMinor(report.totals.incomeBase), tone: 'text-income' },
            { id: 'expense', label: t('cashflow.totalExpense'), value: fromMinor(report.totals.expenseBase), tone: 'text-expense' },
            { id: 'net', label: t('columns.net'), value: fromMinor(report.totals.netBase), tone: report.totals.netBase >= 0 ? 'text-income' : 'text-expense' },
          ].map((card) => (
            <div key={card.id} className="rounded-panel border border-line bg-surface px-5 py-4">
              <p className="mb-1 text-xs text-ink-muted">{card.label}</p>
              <p data-testid={`cashflow-total-${card.id}`} className={cn('text-xl font-bold tabular-nums', card.tone)}>
                {card.value >= 0 && card.id === 'net' ? '+' : ''}
                {formatNum(card.value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {view.status !== 'too_large' && view.status !== 'invalid' && view.status !== 'error' && (
        <>
          <div className="rounded-panel border border-line bg-surface p-4 lg:p-6">
            <CashFlowChart data={buckets} loading={loading} />
          </div>

          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <div className="border-b border-line px-6 py-4">
              <h2 className="text-sm font-semibold text-ink">{report?.granularity === 'day' ? t('cashflow.detailDays') : t('cashflow.detailMonths')}</h2>
            </div>
            {loading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-control bg-canvas" />
                ))}
              </div>
            ) : buckets.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-muted">
                {t('cashflow.empty')}{' '}
                {can('data.write') && (
                  <Link href={`/${orgSlug}/transactions`} className="text-brand-soft-foreground underline">
                    {tCharts('addTransactions')}
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-6 py-3 text-left font-semibold">{unitLabel}</th>
                      <th className="px-6 py-3 text-right font-semibold">{t('columns.income')}</th>
                      <th className="px-6 py-3 text-right font-semibold">{t('columns.expense')}</th>
                      <th className="px-6 py-3 text-right font-semibold">{t('columns.net')}</th>
                      <th className="px-6 py-3 text-right font-semibold">{t('columns.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((row) => (
                      <tr key={row.key} className="border-t border-line hover:bg-canvas">
                        <td className="px-6 py-3 font-medium text-ink">{row.label}</td>
                        <td className="px-6 py-3 text-right text-income">{row.income > 0 ? `+${formatNum(row.income)}` : '—'}</td>
                        <td className="px-6 py-3 text-right text-expense">{row.expense > 0 ? `−${formatNum(row.expense)}` : '—'}</td>
                        <td className={cn('px-6 py-3 text-right font-medium', row.net >= 0 ? 'text-income' : 'text-expense')}>
                          {row.net >= 0 ? '+' : ''}
                          {formatNum(row.net)}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-ink">{formatNum(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {report && (
        <>
          <ExcludedLine excluded={report.excluded} currency={report.currency} testId="cashflow-excluded" />
          <CashFlowAccounts report={report} />
          <CategoryBreakdown lines={report.categories} currency={report.currency} />
          <ReconciliationBlock reconciliation={report.reconciliation} currency={report.currency} />
        </>
      )}
    </div>
  )
}
