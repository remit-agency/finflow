'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { AnalyticsFiltersButton } from '@/components/analytics/AnalyticsFilters'
import BalanceSheet from '@/components/charts/BalanceSheet'
import { ReportNotice } from '@/components/reports/ReportNotice'
import { NativeSelect } from '@/components/ui/native-select'
import { filterAccounts } from '@/lib/domain/analytics-filter/filter'
import { buildCsv, formatAmount } from '@/lib/domain/journal/csv'
import { toDay } from '@/lib/domain/ledger/days'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
import { useBalances } from '@/lib/hooks/useReports'
import { useShell } from '@/lib/hooks/useShell'
import { decimalSignOf } from '@/lib/i18n/format'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { downloadText } from '@/lib/utils/download'
import { AS_OF_OPTIONS, asOfDay, balanceSheetLines, type AsOfOption } from '@/lib/utils/report-view'
import { todayUtcDay } from '@/lib/utils/today'

export default function BalancePage() {
  const t = useTranslations('analytics')
  const tSections = useTranslations('shell.analyticsSections')
  const tTypes = useTranslations('common.accountTypes')
  const tDashboard = useTranslations('reports.dashboard')
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { org, accounts } = useShell()
  const { locale } = useFormatters()
  const [asOf, setAsOf] = useState<AsOfOption>('today')
  // Warsaw's date, read once per visit.
  const [today] = useState(() => toDay(todayUtcDay()))
  // The balances on the chosen day come from the server (S12), the same rule as the dashboard «Гроші зараз».
  const { view, refresh } = useBalances(orgSlug, asOfDay(asOf, today))
  // The Balance is made of accounts: of the report filters (S10f) only the accounts apply; the rest stay in the address.
  const { filters, setFilters } = useAnalyticsFilters('accounts')
  const report = view.status === 'ready' ? view.data : null
  const lines = useMemo(() => (report ? filterAccounts(balanceSheetLines(report, accounts), filters) : []), [report, accounts, filters])
  const missing = report ? report.byCurrency.filter((c) => c.baseMinor === null).map((c) => c.currency) : []

  // The journal's CSV rules (BOM, `;`, CRLF, the decimal sign of the language), from the same server balances.
  const handleExport = () => {
    if (report === null) return
    const decimal = decimalSignOf(locale)
    const header = [t('columns.account'), t('columns.type'), t('columns.balance'), t('columns.currency'), `${t('columns.balance')}, ${report.currency}`]
    const rows = lines.map((l) => [l.name, tTypes(l.type), formatAmount(l.balanceMinor, decimal), l.currency, l.baseMinor === null ? '' : formatAmount(l.baseMinor, decimal)])
    downloadText(`balance-sheet-${report.date}.csv`, buildCsv(header, rows))
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-ink">{tSections('balance')}</h1>
          <p className="text-sm text-ink-muted">
            {t('balance.subtitle')}
            {org?.name ? ` · ${org.name}` : ''}
          </p>
        </div>
        {/* Icon-only below sm so the title keeps its width; the accessible name stays the same. */}
        <button
          onClick={handleExport}
          aria-label={t('exportCsv')}
          className="flex shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors hover:bg-canvas sm:px-4"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{t('exportCsv')}</span>
        </button>
      </div>

      {/* «Станом на» (S12: a real day of the server balances) and the account filter (S10f) */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-muted">{t('balance.asOf')}</span>
        <NativeSelect value={asOf} onChange={(e) => setAsOf(e.target.value as AsOfOption)} aria-label={t('balance.asOfLabel')} className="border-line">
          {AS_OF_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`balance.asOfOptions.${option}`)}
            </option>
          ))}
        </NativeSelect>
        <AnalyticsFiltersButton scope="accounts" value={filters} onChange={setFilters} />
      </div>

      {view.status === 'error' && <ReportNotice kind="error" onRetry={refresh} />}
      {view.status === 'busy' && <ReportNotice kind="busy" onRetry={refresh} />}
      {report && !report.complete && (
        <p data-testid="balance-incomplete" className="text-sm text-expense">
          {tDashboard('incomplete', { currencies: missing.join(', ') })}
        </p>
      )}

      <BalanceSheet lines={lines} orgId={orgSlug} currency={report?.currency ?? org?.currency ?? 'PLN'} loading={view.status === 'loading'} />
    </div>
  )
}
