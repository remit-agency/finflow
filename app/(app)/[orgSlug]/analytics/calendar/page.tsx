'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { CalendarChart } from '@/components/forecast/CalendarChart'
import { CalendarGrid } from '@/components/forecast/CalendarGrid'
import { CashGapBanner } from '@/components/forecast/CashGapBanner'
import { DayPanel } from '@/components/forecast/DayPanel'
import { Button } from '@/components/ui/button'
import { FORECAST_DAYS } from '@/lib/domain/forecast/types'
import { isDay } from '@/lib/domain/ledger/days'
import { useCalendarMonth } from '@/lib/hooks/useCalendarMonth'
import { useForecast } from '@/lib/hooks/useForecast'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { addDaysUtc, daysInMonthUtc, dayKeyUtc, formatMonthTitle, shiftMonth } from '@/lib/utils/calendar-grid'
import { todayDay } from '@/lib/utils/today'

/** `?month=YYYY-MM`: a calendar month (1-12). */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** The payment calendar (S13): the month grid or the chart, the cash gap banner and the day panel. The state is in the address. */
export default function CalendarPage() {
  const t = useTranslations('forecast.calendar')
  const tGap = useTranslations('forecast.gap')
  const { locale } = useFormatters()
  const { orgId, can, accounts } = useShell()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Warsaw's day: the month shown by default is the one Poland is in.
  const [todayKey] = useState(() => todayDay())
  const canEdit = can('data.write')

  const monthParam = searchParams.get('month') ?? ''
  const shownKey = MONTH.test(monthParam) ? monthParam : todayKey.slice(0, 7)
  const year = Number(shownKey.slice(0, 4))
  const month = Number(shownKey.slice(5, 7))
  const dayParam = searchParams.get('day')
  // A day opens the panel only when it is a real day of the month shown.
  const day = isDay(dayParam) && dayParam.slice(0, 7) === shownKey ? dayParam : null
  const chart = searchParams.get('view') === 'chart'

  const { data: calendar, error: calendarError } = useCalendarMonth(orgId, year, month)
  const { forecast } = useForecast(orgId)
  // The hook keeps the last answer while another month is read: only this month's answer is shown.
  const current = calendar !== null && calendar.year === year && calendar.month === month ? calendar : null
  const failed = calendarError && current === null

  // The forecast reaches FORECAST_DAYS after today; a month that ends later is only partly forecast.
  const horizon = dayKeyUtc(addDaysUtc(new Date(`${todayKey}T00:00:00Z`), FORECAST_DAYS))
  const monthEnd = `${shownKey}-${String(daysInMonthUtc(year, month - 1)).padStart(2, '0')}`
  const beyondForecast = monthEnd > horizon

  const notes = current === null ? [] : [
    current.approximate ? tGap('approximate') : null,
    current.truncated ? tGap('incomplete') : null,
    current.unvalued > 0 ? tGap('unvalued', { count: current.unvalued }) : null,
  ].filter((note): note is string => note !== null)

  // Every change writes the address: the other parameters (a tag, for one) stay as they are.
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const goMonth = (key: string) => update({ month: key, day: null })
  const stepMonth = (delta: number) => {
    const ym = shiftMonth({ year, month: month - 1 }, delta)
    goMonth(`${ym.year}-${String(ym.month + 1).padStart(2, '0')}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('subtitle')}</p>
      </div>

      {forecast !== null && <CashGapBanner orgId={orgId} forecast={forecast} link={false} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label={t('prev')} title={t('prev')} data-testid="cal-prev" onClick={() => stepMonth(-1)}>
          <ChevronLeftIcon aria-hidden />
        </Button>
        <h2 className="min-w-40 text-center text-base font-semibold text-ink tabular-nums">
          {formatMonthTitle({ year, month: month - 1 }, locale)}
        </h2>
        <Button type="button" variant="outline" size="icon-sm" aria-label={t('next')} title={t('next')} data-testid="cal-next" onClick={() => stepMonth(1)}>
          <ChevronRightIcon aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => goMonth(todayKey.slice(0, 7))}>
          {t('today')}
        </Button>
        <div role="group" aria-label={t('view.label')} className="ml-auto flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={chart ? 'outline' : 'soft'}
            aria-pressed={!chart}
            data-testid="cal-view-calendar"
            onClick={() => update({ view: null })}
          >
            {t('view.calendar')}
          </Button>
          <Button type="button" size="sm" variant={chart ? 'soft' : 'outline'} aria-pressed={chart} data-testid="cal-view-chart" onClick={() => update({ view: 'chart' })}>
            {t('view.chart')}
          </Button>
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-expense">
          {t('error')}
        </p>
      )}
      {!failed && current === null && (
        <div className="space-y-2" aria-busy="true">
          <p className="text-sm text-ink-muted">{t('loading')}</p>
          <div className="h-96 animate-pulse rounded-panel bg-canvas" />
        </div>
      )}
      {current !== null && (
        <div className="space-y-3">
          {chart ? <CalendarChart month={current} /> : <CalendarGrid month={current} selectedDay={day} onOpenDay={(date) => update({ day: date })} />}
          {(notes.length > 0 || beyondForecast) && (
            <div className="space-y-1 text-xs text-ink-muted">
              {notes.length > 0 && <p data-testid="cal-notes">{notes.join(' · ')}</p>}
              {beyondForecast && <p>{t('noForecast', { days: FORECAST_DAYS })}</p>}
            </div>
          )}
        </div>
      )}

      {day !== null && <DayPanel orgId={orgId} date={day} accounts={accounts} canEdit={canEdit} today={todayKey} onClose={() => update({ day: null })} />}
    </div>
  )
}
