'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { SeriesRow } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'
import { repeatOf } from './labels'

interface Props {
  rows: SeriesRow[]
  accounts: Account[]
  /** The actions of one series (Task 13 passes them for the people who may write). */
  actions?: (row: SeriesRow) => ReactNode
}

/** The series of the company (S11): name, how it repeats and on which account, the next date, the amount, the state. */
export function SeriesList({ rows, accounts, actions }: Props) {
  const t = useTranslations('recurring')
  const { locale, money } = useFormatters()
  if (rows.length === 0) {
    return (
      <p data-testid="series-empty" className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-ink-muted">
        {t('series.empty')}
      </p>
    )
  }
  return (
    <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
      {rows.map((s) => {
        const repeat = repeatOf(s, locale)
        const account = accounts.find((a) => a.id === s.accountId)?.name ?? '—'
        return (
          <li key={s.id} data-testid="series-row" className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{s.name}</p>
              <p className="truncate text-xs text-ink-muted">{`${t(`repeat.${repeat.key}`, repeat.values)} · ${account}`}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:justify-end">
              <span data-testid="series-next" className="tabular-nums text-ink-muted">
                {s.next === null ? t('series.noNext') : formatDayShortUtc(new Date(`${s.next}T00:00:00Z`), locale)}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {money(fromMinor(s.amountMinor), s.currency)}
                {s.estimated && <span className="ml-1 text-xs font-normal text-ink-muted">{t('series.estimated')}</span>}
              </span>
              <Badge variant="chip" data-testid="series-state">
                {s.status === 'active' ? t('series.active') : t('series.paused')}
              </Badge>
              {actions?.(s)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
