'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { NativeSelect } from '@/components/ui/native-select'
import { useShell } from '@/lib/hooks/useShell'
import { exportToCSV } from '@/lib/utils/export'
import BalanceSheet from '@/components/charts/BalanceSheet'
import { Download } from 'lucide-react'

// The label of a period is `analytics.balance.periods.<slug>`.
const PERIODS = ['currentMonth', 'quarter', 'year'] as const

export default function BalancePage() {
  const t = useTranslations('analytics')
  const tSections = useTranslations('shell.analyticsSections')
  // Org and accounts come from the shell (the URL's org, one accounts subscription).
  const { orgId, org, accounts, accountsLoading } = useShell()
  // Amounts are shown in the company currency, so wait for the org as well.
  const loading = accountsLoading || !org
  const [selectedPeriod, setSelectedPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[0])

  const handleExport = () => {
    exportToCSV(
      accounts.map((acc) => ({
        [t('columns.account')]: acc.name,
        [t('columns.type')]: acc.type,
        [t('columns.balance')]: acc.balance,
        [t('columns.currency')]: acc.currency,
      })),
      `balance-sheet`
    )
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx.
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold text-ink">{tSections('balance')}</h1>
            <p className="text-sm text-ink-muted">
              {t('balance.subtitle')}{org?.name ? ` · ${org.name}` : ''}
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

        {/* Period dropdown */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-muted">{t('balance.asOf')}</span>
          <NativeSelect
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as (typeof PERIODS)[number])}
            aria-label={t('balance.asOfLabel')}
            className="border-line"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`balance.periods.${p}`)}</option>
            ))}
          </NativeSelect>
        </div>

        {/* Balance sheet */}
        <BalanceSheet
          accounts={accounts}
          orgId={orgId ?? 'default'}
          currency={org?.currency ?? 'UAH'}
          loading={loading}
        />
    </div>
  )
}
