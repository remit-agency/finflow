'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { CalendarDay, CalendarMonth } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { buildMonthGrid, dayKeyUtc, formatDayLongUtc, weekdayHeaders, type MonthGridCell } from '@/lib/utils/calendar-grid'

interface Props {
  month: CalendarMonth
  /** The day whose panel is open (`?day=`), outlined in the grid. */
  selectedDay: string | null
  onOpenDay: (date: string) => void
}

/**
 * The month as weeks, Monday first (S13). A day of the month is a button that opens its panel; the figures of the day are in
 * the cell: income and expense, the planned amounts (italic: not happened yet), overdue planned payments and the end balance. Below `sm` the
 * cell shows only the day number, the balance and a dot for planned or overdue payments; the figures are in the day panel.
 * Whole currency units in the cells: the exact amounts are in the panel.
 */
export function CalendarGrid({ month, selectedDay, onOpenDay }: Props) {
  const t = useTranslations('forecast.calendar')
  const { locale, number } = useFormatters()
  // `buildMonthGrid` months are 0-based; CalendarMonth.month is 1-12.
  const weeks = useMemo(() => buildMonthGrid({ year: month.year, month: month.month - 1 }), [month.year, month.month])
  const headers = useMemo(() => weekdayHeaders(locale), [locale])
  const byDate = useMemo(() => new Map(month.days.map((d) => [d.date, d] as const)), [month.days])
  const whole = (minor: number) => number(fromMinor(minor), { maximumFractionDigits: 0, minimumFractionDigits: 0 })

  const outside = (c: MonthGridCell) => (
    <div key={dayKeyUtc(c.date)} className="min-h-14 min-w-0 bg-canvas p-1 text-xs text-ink-subtle opacity-60 sm:min-h-24 sm:p-1.5">
      {c.date.getUTCDate()}
    </div>
  )

  const inside = (c: MonthGridCell) => {
    const key = dayKeyUtc(c.date)
    const d: CalendarDay | undefined = byDate.get(key)
    const isToday = key === month.today
    const planned = d !== undefined && (d.plannedIncomeBase > 0 || d.plannedExpenseBase > 0)
    const overdue = d !== undefined && d.overdueCount > 0
    const balance = d?.endBalanceBase ?? null
    return (
      <button
        key={key}
        type="button"
        data-testid="cal-day"
        data-date={key}
        data-gap={String(d?.gap ?? false)}
        data-selected={key === selectedDay || undefined}
        aria-label={t('dayOpen', { date: formatDayLongUtc(c.date, locale) })}
        onClick={() => onOpenDay(key)}
        className={cn(
          'flex min-h-14 min-w-0 flex-col gap-0.5 bg-surface p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-24 sm:p-1.5',
          d?.belowMinimum && 'bg-expense-soft',
          d?.gap && 'ring-2 ring-expense',
          isToday && !d?.gap && 'ring-1 ring-brand',
          key === selectedDay && 'outline outline-2 -outline-offset-2 outline-brand-soft-foreground',
        )}
      >
        <span className="flex items-center justify-between gap-1">
          <span className={cn('text-xs font-medium tabular-nums text-ink sm:text-sm', isToday && 'inline-flex size-5 items-center justify-center rounded-full bg-brand')}>
            {c.date.getUTCDate()}
          </span>
          {(planned || overdue) && <span aria-hidden data-testid="cal-dot" className={cn('size-1.5 rounded-full sm:hidden', overdue ? 'bg-expense' : 'bg-brand-soft-foreground')} />}
        </span>
        {d !== undefined && d.incomeBase > 0 && <span className="hidden truncate text-[11px] tabular-nums text-income sm:block">{`+${whole(d.incomeBase)}`}</span>}
        {d !== undefined && d.expenseBase > 0 && <span className="hidden truncate text-[11px] tabular-nums text-expense sm:block">{`−${whole(d.expenseBase)}`}</span>}
        {d !== undefined && planned && (
          <span data-testid="cal-planned" className="hidden flex-col text-[11px] italic tabular-nums sm:flex">
            {d.plannedIncomeBase > 0 && <span className="truncate text-income">{`+${whole(d.plannedIncomeBase)}`}</span>}
            {d.plannedExpenseBase > 0 && <span className="truncate text-expense">{`−${whole(d.plannedExpenseBase)}`}</span>}
          </span>
        )}
        {d !== undefined && overdue && (
          <span className="hidden self-start truncate rounded bg-expense-soft px-1 text-[10px] text-expense sm:block">{t('overdue', { count: d.overdueCount })}</span>
        )}
        {balance !== null && (
          <span
            data-testid="cal-balance"
            className={cn(
              'mt-auto truncate text-[11px] tabular-nums text-ink-muted sm:text-xs',
              d !== undefined && d.kind !== 'past' && 'border-t border-dashed border-line pt-0.5 italic',
            )}
          >
            {whole(balance)}
          </span>
        )}
      </button>
    )
  }

  return (
    <div data-testid="cal-grid" className="overflow-hidden rounded-panel border border-line bg-line">
      <div className="grid grid-cols-7 gap-px bg-line">
        {headers.map((h) => (
          <span key={h.full} title={h.full} className="bg-surface py-1.5 text-center text-xs font-medium text-ink-muted">
            {h.short}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={dayKeyUtc(week[0].date)} className="grid grid-cols-7 gap-px">
          {week.map((c) => (c.inMonth ? inside(c) : outside(c)))}
        </div>
      ))}
    </div>
  )
}
