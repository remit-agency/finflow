'use client'

import { useTranslations } from 'next-intl'
import { CalendarClockIcon, CheckIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fromMinor } from '@/lib/domain/ledger/money'
import { isOverdue } from '@/lib/domain/recurring/rows'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import type { PlanActions } from '@/lib/hooks/usePlanActions'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'

interface Props {
  row: PlannedRow
  /** The series name, else the description, else the placeholder: resolved by the caller. */
  name: string
  accountName: string
  /** The row's day as the screen formats it (also in the action label). */
  dateLabel: string
  /** Whether the day is shown as a column (the journal list); the day panel already names the day. */
  showDate: boolean
  /** The Warsaw day: a row dated before it is overdue. */
  today: string
  canEdit: boolean
  plans: PlanActions
  /** `data-testid` of the row and of its overdue badge (each screen keeps its own ids). */
  testId: string
  overdueTestId: string
}

/**
 * One planned operation as a row (S12d): amount, name · account, the overdue and estimated badges and, for `canEdit`, the
 * plan actions «Позначити сплаченою», «Перенести», «Пропустити» (S11). Shared by the journal's «Майбутні платежі» and the
 * calendar's day panel, so both act on a planned row the same way.
 */
export function PlannedRowLine({ row, name, accountName, dateLabel, showDate, today, canEdit, plans, testId, overdueTestId }: Props) {
  const tRec = useTranslations('recurring')
  const { money } = useFormatters()
  const amount = money(fromMinor(row.amountMinor), row.currency)
  const overdue = isOverdue({ status: 'planned', paymentDate: row.paymentDate }, today)
  const busy = plans.busyId !== null
  return (
    <li data-testid={testId} data-overdue={overdue || undefined} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
      {showDate && <span className="w-14 shrink-0 tabular-nums text-ink-muted">{dateLabel}</span>}
      <span className={cn('w-28 shrink-0 font-medium tabular-nums', row.type === 'income' ? 'text-income' : 'text-ink')}>{amount}</span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {name}
        <span className="text-ink-muted">{` · ${accountName}`}</span>
      </span>
      <span className="flex gap-1">
        {overdue && (
          <Badge variant="chip" data-testid={overdueTestId} className="bg-expense-soft text-expense">
            {tRec('planned.overdue')}
          </Badge>
        )}
        {row.estimated && <Badge variant="chip">{tRec('planned.estimated')}</Badge>}
      </span>
      {canEdit && (
        <span role="group" aria-label={tRec('planned.rowActions', { name, amount, date: dateLabel })} className="flex shrink-0 gap-1">
          <Button type="button" size="icon-sm" variant="soft" disabled={busy} title={tRec('planned.markPaid')} aria-label={tRec('planned.markPaid')} onClick={() => plans.markPaid(row)}>
            <CheckIcon aria-hidden />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={busy} title={tRec('planned.move')} aria-label={tRec('planned.move')} onClick={() => plans.setMoving(row)}>
            <CalendarClockIcon aria-hidden />
          </Button>
          {row.seriesId !== undefined && row.occurrence !== undefined && (
            <Button type="button" size="icon-sm" variant="outline" disabled={busy} title={tRec('planned.skip')} aria-label={tRec('planned.skip')} onClick={() => plans.skip(row)}>
              <XIcon aria-hidden />
            </Button>
          )}
        </span>
      )}
    </li>
  )
}
