'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { useTransactions } from '@/lib/hooks/useTransactions'
import CalendarView from '@/components/charts/CalendarView'

export default function CalendarPage() {
  const t = useTranslations('analytics')
  const tSections = useTranslations('shell.analyticsSections')
  const params = useParams()
  const orgSlug = params.orgSlug as string
  const orgId = orgSlug
  const { transactions, loading: txLoading } = useTransactions(orgId)
  // Totals are shown in the company currency, so wait for the org as well.
  const { org } = useShell()
  const loading = txLoading || !org

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const handleNavigate = (dir: 'prev' | 'next') => {
    if (dir === 'prev') {
      if (month === 0) { setMonth(11); setYear(y => y - 1) }
      else setMonth(m => m - 1)
    } else {
      if (month === 11) { setMonth(0); setYear(y => y + 1) }
      else setMonth(m => m + 1)
    }
  }

  return (
    // The shared container and the reports' sub-navigation come from analytics/layout.tsx; the
    // day list keeps a narrower, readable width inside it.
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">{tSections('calendar')}</h1>
        <p className="text-sm text-ink-muted">{t('calendar.subtitle')}</p>
      </div>

      <CalendarView
        transactions={transactions}
        year={year}
        month={month}
        onNavigate={handleNavigate}
        currency={org?.currency ?? 'UAH'}
        loading={loading}
      />
    </div>
  )
}
