'use client'

import { useState } from 'react'
import { Transaction } from '@/types'
import { buildCalendar, DayData } from '@/lib/utils/analytics'
import { ChevronLeft, ChevronRight, ChevronRight as ExpandIcon } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { TOKEN_COLORS } from '@/lib/ui/colors'
import { todayUtcDay } from '@/lib/utils/today'

interface CalendarViewProps {
  transactions: Transaction[]
  year: number
  month: number
  onNavigate: (dir: 'prev' | 'next') => void
  /** The company currency, used for the day and month totals. */
  currency: string
  loading?: boolean
}

/** «жовтень» -> «Жовтень»: month and weekday names start a label, so they get a capital. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl bg-canvas animate-pulse" />
      ))}
    </div>
  )
}

interface DayRowProps {
  day: DayData
  dayNum: number
  year: number
  month: number
  transactions: Transaction[]
  currency: string
}

function DayRow({ day, dayNum, year, month, transactions, currency }: DayRowProps) {
  const t = useTranslations('charts.calendar')
  const { money, weekday } = useFormatters()
  const [expanded, setExpanded] = useState(false)

  const dayTxs = transactions.filter((tx) => {
    const d = tx.date instanceof Date ? tx.date : new Date(tx.date)
    return (
      d.getFullYear() === year &&
      d.getMonth() === month &&
      d.getDate() === dayNum
    )
  })

  // A calendar day (UTC midnight, like the stored dates): its weekday never depends on the time zone.
  const dayDate = new Date(Date.UTC(year, month, dayNum))
  const dow = capitalize(weekday(dayDate, 'short'))
  const isWeekend = dayDate.getUTCDay() === 0 || dayDate.getUTCDay() === 6
  const isToday = day.date === todayUtcDay().toISOString().slice(0, 10)

  return (
    <>
      <div
        className={[
          'flex items-center gap-3 px-4 py-3 border-b border-line transition-colors',
          day.hasTransactions ? 'cursor-pointer hover:bg-canvas' : '',
          isToday ? 'bg-brand-soft' : '',
        ].join(' ')}
        onClick={() => day.hasTransactions && setExpanded((v) => !v)}
      >
        {/* Day label */}
        <div className="flex items-center gap-1.5 w-14 shrink-0">
          <span className={`text-xs font-medium ${isWeekend ? 'text-expense' : 'text-ink-muted'}`}>
            {dow}
          </span>
          <span className="text-sm font-semibold text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {String(dayNum).padStart(2, '0')}
          </span>
        </div>

        {/* Dots separator */}
        <div className="flex-1 border-b border-dotted border-line self-center" />

        {/* Amounts */}
        <div className="flex items-center gap-4 shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {day.income > 0 ? (
            <span className="text-sm font-medium text-income min-w-[90px] text-right">
              +{money(day.income, currency)}
            </span>
          ) : (
            <span className="min-w-[90px]" />
          )}
          {day.expense > 0 ? (
            <span className="text-sm font-medium text-expense min-w-[90px] text-right">
              -{money(day.expense, currency)}
            </span>
          ) : (
            <span className="min-w-[90px]" />
          )}
          <span
            className="text-sm min-w-[90px] text-right"
            style={{ color: day.balance >= 0 ? TOKEN_COLORS.inkMuted : TOKEN_COLORS.expense }}
          >
            {money(day.balance, currency)}
          </span>
        </div>

        {/* Expand arrow */}
        {day.hasTransactions && (
          <ExpandIcon
            className={`w-4 h-4 text-ink-muted transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </div>

      {/* Accordion: transactions for this day */}
      {expanded && dayTxs.length > 0 && (
        <div className="bg-canvas border-b border-line">
          {dayTxs.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between px-8 py-2 text-sm border-b border-line last:border-0"
            >
              <div className="flex flex-col">
                <span className="text-ink">
                  {tx.description || (tx.type === 'income' ? t('income') : tx.type === 'expense' ? t('expense') : t('transfer'))}
                </span>
              </div>
              <span
                className="font-medium"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: tx.type === 'income' ? TOKEN_COLORS.income : tx.type === 'expense' ? TOKEN_COLORS.expense : TOKEN_COLORS.inkMuted,
                }}
              >
                {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                {money(tx.amount, tx.currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function CalendarView({ transactions, year, month, onNavigate, currency, loading }: CalendarViewProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { can } = useShell()
  const t = useTranslations('charts.calendar')
  const tCharts = useTranslations('charts')
  const { money, date } = useFormatters()
  const days = buildCalendar(transactions, year, month)
  const totalIncome = days.reduce((s, d) => s + d.income, 0)
  const totalExpense = days.reduce((s, d) => s + d.expense, 0)

  return (
    <div className="space-y-4">
      {/* Navigation header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('prev')}
          className="p-2 rounded-lg hover:bg-canvas transition-colors text-ink-muted hover:text-ink"
          aria-label={t('previousMonth')}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center gap-0.5">
          <h3 className="text-base font-semibold text-ink">
            {capitalize(date(new Date(Date.UTC(year, month, 1)), { month: 'long' }))} {year}
          </h3>
          <div className="flex gap-3 text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {totalIncome > 0 && (
              <span className="text-income">+{money(totalIncome, currency)}</span>
            )}
            {totalExpense > 0 && (
              <span className="text-expense">-{money(totalExpense, currency)}</span>
            )}
          </div>
        </div>

        <button
          onClick={() => onNavigate('next')}
          className="p-2 rounded-lg hover:bg-canvas transition-colors text-ink-muted hover:text-ink"
          aria-label={t('nextMonth')}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <Skeleton />
      ) : days.every(d => !d.hasTransactions) ? (
        <div className="rounded-xl border border-line flex flex-col items-center justify-center gap-2 py-16">
          <p className="text-ink-muted">{t('empty')}</p>
          {can('data.write') && (
            <Link href={`/${orgSlug}/transactions`} className="text-brand-soft-foreground text-sm underline underline-offset-2">
              {tCharts('addTransactions')}
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden bg-white">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-2 bg-canvas border-b border-line text-xs text-ink-muted font-semibold uppercase tracking-wide">
            <div className="w-14 shrink-0">{t('day')}</div>
            <div className="flex-1" />
            <div className="flex items-center gap-4 shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="min-w-[90px] text-right text-income">{t('income')}</span>
              <span className="min-w-[90px] text-right text-expense">{t('expense')}</span>
              <span className="min-w-[90px] text-right">{t('balance')}</span>
            </div>
            <div className="w-4" />
          </div>
          {days.map((day, i) => (
            <DayRow
              key={day.date}
              day={day}
              dayNum={i + 1}
              year={year}
              month={month}
              transactions={transactions}
              currency={currency}
            />
          ))}
        </div>
      )}
    </div>
  )
}
