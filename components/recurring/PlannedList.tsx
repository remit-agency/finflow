'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fromMinor } from '@/lib/domain/ledger/money'
import { isOverdue } from '@/lib/domain/recurring/rows'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

interface Props {
  overdue: PlannedRow[]
  upcoming: PlannedRow[]
  /** Series names by id. */
  names: ReadonlyMap<string, string>
  accounts: Account[]
  canEdit: boolean
  today: string
  /** The row an action is running for: every action waits meanwhile. */
  busyId: string | null
  onMarkPaid: (row: PlannedRow) => void
  onMove: (row: PlannedRow) => void
  onSkip: (row: PlannedRow) => void
}

/** The overdue and the next 31 days of planned operations (S11), as cards, with «Позначити сплаченою», «Перенести», «Пропустити». */
export function PlannedList(props: Props) {
  const t = useTranslations('recurring')
  const tPlans = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  if (props.overdue.length === 0 && props.upcoming.length === 0) {
    return <p className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-ink-muted">{t('planned.empty')}</p>
  }

  const card = (row: PlannedRow) => {
    const name = (row.seriesId !== undefined ? props.names.get(row.seriesId) : undefined) ?? row.description ?? tPlans('unnamed')
    const date = formatDayShortUtc(new Date(`${row.paymentDate}T00:00:00Z`), locale)
    const amount = money(fromMinor(row.amountMinor), row.currency)
    const account = props.accounts.find((a) => a.id === row.accountId)?.name ?? '—'
    const overdue = isOverdue({ status: 'planned', paymentDate: row.paymentDate }, props.today)
    const busy = props.busyId !== null
    return (
      <li key={row.id} data-testid="planned-row" data-overdue={overdue || undefined} className="flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{name}</p>
          <p className="truncate text-xs tabular-nums text-ink-muted">{`${date} · ${account}`}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="chip" data-testid={overdue ? 'plan-overdue' : 'plan-planned'} className={overdue ? 'bg-expense-soft text-expense' : undefined}>
              {overdue ? t('planned.overdue') : t('planned.planned')}
            </Badge>
            {row.estimated && <Badge variant="chip" data-testid="plan-estimated">{t('planned.estimated')}</Badge>}
            {row.manual && <Badge variant="chip">{t('planned.manual')}</Badge>}
          </div>
        </div>
        <span className={cn('font-semibold tabular-nums sm:w-32 sm:text-right', row.type === 'income' ? 'text-income' : 'text-ink')}>{amount}</span>
        {props.canEdit && (
          <div role="group" aria-label={t('planned.rowActions', { name, amount, date })} className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="soft" disabled={busy} onClick={() => props.onMarkPaid(row)}>
              {t('planned.markPaid')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => props.onMove(row)}>
              {t('planned.move')}
            </Button>
            {row.seriesId !== undefined && row.occurrence !== undefined && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => props.onSkip(row)}>
                {t('planned.skip')}
              </Button>
            )}
          </div>
        )}
      </li>
    )
  }

  const group = (title: string, rows: PlannedRow[]) =>
    rows.length === 0 ? null : (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
        <ul className="space-y-2">{rows.map(card)}</ul>
      </div>
    )

  return (
    <div className="space-y-4">
      {group(t('planned.overdueTitle'), props.overdue)}
      {group(t('planned.upcomingTitle'), props.upcoming)}
    </div>
  )
}
