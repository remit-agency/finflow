'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ReportNotice } from '@/components/reports/ReportNotice'
import { fromDay } from '@/lib/domain/ledger/days'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useDashboard } from '@/lib/hooks/useReports'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { cn } from '@/lib/utils'
import { inShellOrder } from '@/lib/utils/report-view'

/** «Гроші зараз» (S12): the balance of every account today, and the total in the company currency at NBP rates. */
export default function DashboardPage() {
  const t = useTranslations('reports.dashboard')
  const tReconciliation = useTranslations('reports.reconciliation')
  const tTypes = useTranslations('common.accountTypes')
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { accounts } = useShell()
  const { view, refresh } = useDashboard(orgSlug)
  const { money, number, date } = useFormatters()
  const report = view.status === 'ready' ? view.data : null
  const lines = report ? inShellOrder(report.accounts, accounts) : []
  const sync = new Map((report?.bank ?? []).map((b) => [b.accountId, b.lastSyncAt]))
  const missing = report ? report.byCurrency.filter((c) => c.baseMinor === null).map((c) => c.currency) : []
  const pending = report ? report.byCurrency.some((c) => c.rate !== null && !c.rate.final) : false
  const day = (d: string) => date(fromDay(d), { day: '2-digit', month: '2-digit', year: 'numeric' })
  const rate = (r: number) => number(r, { minimumFractionDigits: 4, maximumFractionDigits: 4 })

  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-6')}>
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('subtitle')}</p>
      </div>

      {view.status === 'error' && <ReportNotice kind="error" onRetry={refresh} />}
      {view.status === 'busy' && <ReportNotice kind="busy" onRetry={refresh} />}
      {view.status === 'loading' && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-panel bg-canvas" />
          ))}
        </div>
      )}

      {report && (
        <>
          <section data-testid="dashboard-total" className="rounded-panel border border-line bg-surface px-5 py-4">
            <p className="text-xs text-ink-muted">{t('total', { currency: report.currency })}</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{money(fromMinor(report.totalBase), report.currency)}</p>
            {!report.complete && (
              <p data-testid="dashboard-incomplete" className="mt-1 text-xs text-expense">
                {t('incomplete', { currencies: missing.join(', ') })}
              </p>
            )}
            {pending && <p className="mt-1 text-xs text-ink-subtle">{tReconciliation('pending')}</p>}
          </section>

          {report.byCurrency.length > 1 && (
            <section aria-labelledby="dashboard-currencies" className="overflow-hidden rounded-panel border border-line bg-surface">
              <h2 id="dashboard-currencies" className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">{t('byCurrency')}</h2>
              <ul className="divide-y divide-line">
                {report.byCurrency.map((c) => (
                  <li key={c.currency} data-testid="dashboard-currency" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                    <span className="font-medium text-ink">{c.currency}</span>
                    <span className="min-w-0 text-right tabular-nums text-ink">
                      {money(fromMinor(c.balanceMinor), c.currency)}
                      {c.currency !== report.currency && (
                        <span className="block text-xs text-ink-muted">
                          {c.baseMinor === null || c.rate === null
                            ? t('noRate')
                            : `${money(fromMinor(c.baseMinor), report.currency)} · ${t('rate', { rate: rate(c.rate.rate), date: day(c.rate.rateDate) })}`}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="dashboard-accounts" className="overflow-hidden rounded-panel border border-line bg-surface">
            <h2 id="dashboard-accounts" className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">{t('accounts')}</h2>
            {lines.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-muted">{t('empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {lines.map((a) => {
                  const last = sync.get(a.accountId) ?? null
                  return (
                    <li key={a.accountId} data-testid="dashboard-account" className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{a.name}</p>
                          <p className="truncate text-xs text-ink-subtle">
                            {tTypes(a.type)}
                            {sync.has(a.accountId) && (
                              <span data-testid="dashboard-sync">
                                {' · '}
                                {last ? t('lastSync', { date: date(new Date(last), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' }) }) : t('neverSynced')}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className={cn('font-semibold', a.balanceMinor < 0 ? 'text-expense' : 'text-ink')}>{money(fromMinor(a.balanceMinor), a.currency)}</p>
                        {a.currency !== report.currency && (
                          <p className="text-xs text-ink-muted">{a.baseMinor === null ? t('noRate') : money(fromMinor(a.baseMinor), report.currency)}</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
