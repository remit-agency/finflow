'use client'

import { useTranslations } from 'next-intl'
import { fromDay } from '@/lib/domain/ledger/days'
import { fromMinor } from '@/lib/domain/ledger/money'
import { ratesNbpDidNotGive } from '@/lib/domain/reports/reconcile'
import { MAX_RATE_MONTHS, type Reconciliation } from '@/lib/domain/reports/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'

interface Line {
  id: string
  label: string
  value: number | null
  tone?: 'strong' | 'bad'
}

/**
 * «Звірка із залишками» (S12) under Cash Flow and P&L: the opening balance, the lines that move it and the closing balance,
 * in the company currency. A line that only explains a split (outside the filter, transfers) is left out at 0;
 * «Розбіжність» shows whenever the equation does not hold, never rounded away.
 */
export function ReconciliationBlock({ reconciliation: r, currency }: { reconciliation: Reconciliation; currency: string }) {
  const t = useTranslations('reports.reconciliation')
  const { money, date, number } = useFormatters()
  const day = (d: string) => date(fromDay(d), { day: '2-digit', month: '2-digit', year: 'numeric' })
  const amount = (minor: number | null) => (minor === null ? '—' : money(fromMinor(minor), currency))
  const lines: Line[] = [
    { id: 'opening', label: t('opening', { date: day(r.openingDay) }), value: r.openingBase, tone: 'strong' },
    { id: 'net', label: t('net'), value: r.reportNetBase },
  ]
  if (r.excludedBase !== null) lines.push({ id: 'excluded', label: t('excluded'), value: r.excludedBase })
  if (r.outsideFilterBase !== 0) lines.push({ id: 'outside', label: t('outside'), value: r.outsideFilterBase })
  if (r.transfersBase !== 0) lines.push({ id: 'transfers', label: t('transfers'), value: r.transfersBase })
  if (r.rates.length > 0) lines.push({ id: 'fx', label: t('fx'), value: r.fxBase })
  lines.push({ id: 'closing', label: t('closing', { date: day(r.closingDay) }), value: r.closingBase, tone: 'strong' })
  if (r.discrepancyBase !== null && r.discrepancyBase !== 0) lines.push({ id: 'discrepancy', label: t('discrepancy'), value: r.discrepancyBase, tone: 'bad' })
  const missing = [...new Set(ratesNbpDidNotGive(r).map((m) => m.currency))].join(', ')
  const pending = r.rates.some((x) => x.closing !== null && !x.closing.final)
  return (
    <section aria-labelledby="reconciliation-title" data-testid="reconciliation" className="rounded-panel border border-line bg-surface">
      <h2 id="reconciliation-title" className="border-b border-line px-6 py-4 text-sm font-semibold text-ink">{t('title')}</h2>
      <dl className="divide-y divide-line px-6">
        {lines.map((line) => (
          <div key={line.id} data-testid={`recon-${line.id}`} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
            <dt className={cn('min-w-0', line.tone === 'strong' ? 'font-semibold text-ink' : line.tone === 'bad' ? 'font-semibold text-expense' : 'text-ink-muted')}>{line.label}</dt>
            <dd className={cn('shrink-0 tabular-nums', line.tone === 'bad' ? 'font-semibold text-expense' : line.tone === 'strong' ? 'font-semibold text-ink' : 'text-ink')}>
              {amount(line.value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1 border-t border-line px-6 py-3 text-xs text-ink-muted">
        {r.discrepancyBase === 0 && <p data-testid="recon-ok" className="font-medium text-income">{t('ok')}</p>}
        {r.excludedIncluded && <p data-testid="recon-included">{t('included')}</p>}
        {ratesNbpDidNotGive(r).length > 0 && <p data-testid="recon-unvalued" className="text-expense">{t('unvalued', { currencies: missing })}</p>}
        {r.unrequestedRates.length > 0 && (
          <p data-testid="recon-unrequested" className="text-expense">
            {t('unrequested', { count: number(r.unrequestedRates.length), months: number(MAX_RATE_MONTHS) })}
          </p>
        )}
        {r.rates.map((x) =>
          x.closing === null ? null : (
            <p key={x.currency} data-testid="recon-rate">
              {t('rate', { currency: x.currency, rate: number(x.closing.rate, { minimumFractionDigits: 4, maximumFractionDigits: 4 }), date: day(x.closing.rateDate) })}
            </p>
          ),
        )}
        {pending && <p data-testid="recon-pending">{t('pending')}</p>}
      </div>
    </section>
  )
}
