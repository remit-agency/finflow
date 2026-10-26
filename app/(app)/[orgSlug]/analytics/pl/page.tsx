'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTransactions } from '@/lib/hooks/useTransactions'
import { useShell } from '@/lib/hooks/useShell'
import { buildPL } from '@/lib/utils/analytics'
import { exportToCSV } from '@/lib/utils/export'
import { DEFAULT_REPORT_PERIOD, periodSlug, resolvePeriod, type PeriodSelection } from '@/lib/utils/period'
import { todayUtcDay } from '@/lib/utils/today'
import PLTable from '@/components/charts/PLTable'
import PLSummaryCharts from '@/components/charts/PLSummaryCharts'
import { ReportToolbar } from '@/components/analytics/ReportToolbar'

export default function PLPage() {
  const t = useTranslations('analytics')
  const noCategory = useTranslations('journal.list')('noCategory')
  const params = useParams()
  const orgSlug = params.orgSlug as string
  const orgId = orgSlug
  const { transactions, loading: txLoading } = useTransactions(orgId)
  // Categories come from ShellProvider (one subscription, one default-category seed per org).
  const { incomeCategories, expenseCategories, categoriesLoading: catLoading } = useShell()
  const categories = [...incomeCategories, ...expenseCategories]
  const [period, setPeriod] = useState<PeriodSelection>(DEFAULT_REPORT_PERIOD)
  // Warsaw's date, read once per visit (presets resolve against it).
  const [now] = useState(() => todayUtcDay())

  const loading = txLoading || catLoading

  const { monthKeys, rows } = useMemo(
    () => buildPL(transactions, categories, resolvePeriod(period, now), noCategory),
    [transactions, categories, period, now, noCategory]
  )

  const handleExport = () => {
    exportToCSV(
      rows.map((row) => ({
        [t('columns.category')]: row.categoryName,
        [t('columns.type')]: row.type === 'income' ? t('columns.income') : t('columns.expense'),
        ...Object.fromEntries(monthKeys.map((k) => [k, row.months[k] ?? 0])),
        [t('columns.total')]: row.total,
      })),
      `pl-${periodSlug(period)}`
    )
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div className="space-y-6">
        {/* Header and the report toolbar (period first, then the actions), as in Finmap */}
        <div className="space-y-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-ink">{t('pl.title')}</h1>
            <p className="text-sm text-ink-muted">{t('pl.subtitle')}</p>
          </div>
          <ReportToolbar period={period} onPeriodChange={setPeriod} onExport={handleExport} />
        </div>

        {/* Summary + pie charts */}
        {!loading && rows.length > 0 && <PLSummaryCharts rows={rows} />}

        {/* Table */}
        <PLTable rows={rows} monthKeys={monthKeys} loading={loading} />
    </div>
  )
}
