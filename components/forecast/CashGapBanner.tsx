'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TriangleAlertIcon } from 'lucide-react'
import type { Forecast } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'

interface Props {
  orgId: string
  forecast: Forecast
  /** The calendar page itself shows the banner without the link. */
  link?: boolean
}

/**
 * «24 лис: баланс впаде до −3 200 PLN (мінімум 0)» (S13): shown only when the forecast has a cash gap. Names the largest
 * planned payment of that day, says when the figures are approximate or incomplete, and links to the day in the calendar.
 */
export function CashGapBanner({ orgId, forecast, link = true }: Props) {
  const t = useTranslations('forecast.gap')
  const { locale, money } = useFormatters()
  const gap = forecast.gap
  if (gap === null) return null
  const amount = (minor: number) => money(fromMinor(minor), forecast.currency)
  const day = formatDayShortUtc(new Date(`${gap.date}T00:00:00Z`), locale)
  const title = gap.date === forecast.today ? t('titleToday', { balance: amount(gap.balanceBase), minimum: amount(gap.minimumBase) }) : t('title', { date: day, balance: amount(gap.balanceBase), minimum: amount(gap.minimumBase) })
  const top = gap.causes[0]
  const notes = [forecast.approximate ? t('approximate') : null, forecast.truncated ? t('incomplete') : null, forecast.unvalued > 0 ? t('unvalued', { count: forecast.unvalued }) : null].filter((n): n is string => n !== null)
  return (
    <section data-testid="cash-gap" role="alert" className="flex flex-wrap items-start gap-3 rounded-panel border border-expense/40 bg-expense-soft px-4 py-3 text-sm text-ink">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-expense" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p data-testid="cash-gap-title" className="m-0 font-semibold">{title}</p>
        {top !== undefined && (
          <p data-testid="cash-gap-cause" className="m-0 text-ink-muted">
            {top.label !== null ? t('cause', { label: top.label, amount: money(fromMinor(top.amountMinor), top.currency) }) : t('causeNoLabel', { amount: money(fromMinor(top.amountMinor), top.currency) })}
          </p>
        )}
        {notes.length > 0 && <p data-testid="cash-gap-notes" className="m-0 text-xs text-ink-muted">{notes.join(' · ')}</p>}
      </div>
      {link && (
        <Link data-testid="cash-gap-link" href={`/${orgId}/analytics/calendar?month=${gap.date.slice(0, 7)}&day=${gap.date}`} className="shrink-0 text-brand-soft-foreground underline-offset-4 hover:underline">
          {t('open')}
        </Link>
      )}
    </section>
  )
}
