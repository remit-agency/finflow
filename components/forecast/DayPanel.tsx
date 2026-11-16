'use client'

import { useTranslations } from 'next-intl'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { PlannedRowLine } from '@/components/recurring/PlannedRowLine'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DAY_ROWS } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useCalendarDay } from '@/lib/hooks/useCalendarDay'
import { usePlanActions } from '@/lib/hooks/usePlanActions'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { formatDayLongUtc } from '@/lib/utils/calendar-grid'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

interface Props {
  orgId: string
  /** The day (`YYYY-MM-DD`) whose payments are listed. */
  date: string
  accounts: Account[]
  canEdit: boolean
  /** The Warsaw day: planned rows dated before it are overdue. */
  today: string
  onClose: () => void
}

/**
 * The payments of one day of the calendar (S13), in a dialog: the planned ones first, with the plan actions for `canEdit`,
 * then the operations of the day. The full amounts are here; the grid shows whole units.
 */
export function DayPanel({ orgId, date, accounts, canEdit, today, onClose }: Props) {
  const t = useTranslations('forecast.day')
  const tCal = useTranslations('forecast.calendar')
  const tPlans = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  const { data, error } = useCalendarDay(orgId, date)
  const plans = usePlanActions(orgId, today)
  const dayStart = new Date(`${date}T00:00:00Z`)
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { date: formatDayLongUtc(dayStart, locale) })}</DialogTitle>
        </DialogHeader>
        {data === null ? (
          <p className="text-sm text-ink-muted">{error ? tCal('error') : tCal('loading')}</p>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            {data.planned.length > 0 && (
              <section aria-label={t('planned')}>
                <h3 className="m-0 px-4 pb-1 text-xs font-medium text-ink-muted">{t('planned')}</h3>
                <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-canvas">
                  {data.planned.map((r) => (
                    <PlannedRowLine
                      key={r.id}
                      row={r}
                      name={(r.seriesId !== undefined ? data.names[r.seriesId] : undefined) ?? r.description ?? tPlans('unnamed')}
                      accountName={accountName(r.accountId)}
                      dateLabel={formatDayShortUtc(dayStart, locale)}
                      showDate={false}
                      today={today}
                      canEdit={canEdit}
                      plans={plans}
                      testId="day-planned"
                      overdueTestId="day-overdue"
                    />
                  ))}
                </ul>
              </section>
            )}
            {data.actual.length > 0 && (
              <section aria-label={t('actual')}>
                <h3 className="m-0 px-4 pb-1 text-xs font-medium text-ink-muted">{t('actual')}</h3>
                <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-canvas">
                  {data.actual.map((a) => (
                    <li key={a.id} data-testid="day-actual" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                      <span
                        className={cn(
                          'w-28 shrink-0 font-medium tabular-nums',
                          a.type === 'income' && 'text-income',
                          a.type === 'expense' && 'text-expense',
                          a.type === 'transfer' && 'text-ink-muted',
                        )}
                      >
                        {`${a.type === 'income' ? '+' : a.type === 'expense' ? '−' : ''}${money(fromMinor(a.amountMinor), a.currency)}`}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {a.description ?? '—'}
                        <span className="text-ink-muted">{` · ${accountName(a.accountId)}`}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.planned.length === 0 && data.actual.length === 0 && <p className="px-4 text-sm text-ink-muted">{t('empty')}</p>}
            {data.truncated && <p className="px-4 text-xs text-ink-muted">{t('truncated', { count: DAY_ROWS })}</p>}
          </div>
        )}
        {plans.moving !== null && <MoveDateDialog row={plans.moving} onConfirm={plans.move} onClose={() => plans.setMoving(null)} />}
      </DialogContent>
    </Dialog>
  )
}
