'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CalendarMonth } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { TOKEN_COLORS } from '@/lib/ui/colors'

interface ChartPoint {
  /** The day of the month («5»): the category of the x axis. */
  label: string
  /** Actual end balance of a past day, in the company currency. */
  actual: number | null
  /** Forecast end balance from today on; the last past day repeats its value so the two lines join. */
  forecast: number | null
}

/** One point per day of the month, in major units (the minor units of the month divided by 100). */
export function chartPoints(month: CalendarMonth): ChartPoint[] {
  return month.days.map((d, i) => {
    const value = d.endBalanceBase === null ? null : fromMinor(d.endBalanceBase)
    const isLastPast = d.kind === 'past' && month.days[i + 1]?.kind === 'today'
    return {
      label: String(Number(d.date.slice(8))),
      actual: d.kind === 'past' ? value : null,
      forecast: d.kind !== 'past' || isLastPast ? value : null,
    }
  })
}

/** The balance of the month as a line: actual before today, forecast from today, with the minimum and the cash gap marked (S13). */
export function CalendarChart({ month }: { month: CalendarMonth }) {
  const t = useTranslations('forecast.calendar')
  const { number } = useFormatters()
  const points = useMemo(() => chartPoints(month), [month])
  const whole = (n: number) => number(n, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const gapLabel = month.gapDate === null ? null : String(Number(month.gapDate.slice(8)))
  const tick = { fontSize: 12, fill: TOKEN_COLORS.inkMuted }

  return (
    <div data-testid="cal-chart" className="h-80 w-full rounded-panel border border-line bg-surface p-2 sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={TOKEN_COLORS.line} vertical={false} />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => whole(Number(v))} width={70} />
          <Tooltip formatter={(v) => whole(Number(v))} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: TOKEN_COLORS.inkMuted, paddingTop: 8 }}
            formatter={(value) => (value === 'actual' ? t('balance') : t('forecastBalance'))}
          />
          <ReferenceLine
            y={fromMinor(month.minimumBase)}
            stroke={TOKEN_COLORS.inkMuted}
            strokeDasharray="4 4"
            label={{ value: t('minimum'), position: 'insideTopLeft', fill: TOKEN_COLORS.inkMuted, fontSize: 12 }}
          />
          {gapLabel !== null && (
            <ReferenceLine x={gapLabel} stroke={TOKEN_COLORS.expense} label={{ value: t('gapDay'), position: 'insideTopRight', fill: TOKEN_COLORS.expense, fontSize: 12 }} />
          )}
          <Line type="monotone" dataKey="actual" stroke={TOKEN_COLORS.brand} strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke={TOKEN_COLORS.ink} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
