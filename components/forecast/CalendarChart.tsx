'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CalendarMonth } from '@/lib/domain/forecast/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { TOKEN_COLORS } from '@/lib/ui/colors'
import { chartPoints, gapDayLabel, wholeUnits } from '@/lib/utils/forecast-view'

/** The balance of the month as a line: actual before today, forecast from today, with the minimum and the cash gap marked (S13). */
export function CalendarChart({ month }: { month: CalendarMonth }) {
  const t = useTranslations('forecast.calendar')
  const { number } = useFormatters()
  const points = useMemo(() => chartPoints(month), [month])
  const whole = (major: number) => number(wholeUnits(major), { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  // The gap marker sits on the gap day only when that day is in this month (the month's gapDate may lie elsewhere).
  const gapLabel = gapDayLabel(month)
  const tick = { fontSize: 12, fill: TOKEN_COLORS.inkMuted }

  return (
    <div data-testid="cal-chart" className="h-80 w-full rounded-panel border border-line bg-surface p-2 sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={TOKEN_COLORS.line} vertical={false} />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => whole(Number(v))} width={70} />
          <Tooltip formatter={(v) => `${whole(Number(v))} ${month.currency}`} />
          <Legend wrapperStyle={{ fontSize: 12, color: TOKEN_COLORS.inkMuted, paddingTop: 8 }} />
          <ReferenceLine
            y={fromMinor(month.minimumBase)}
            stroke={TOKEN_COLORS.inkMuted}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{ value: t('minimum'), position: 'insideTopLeft', fill: TOKEN_COLORS.inkMuted, fontSize: 12 }}
          />
          {gapLabel !== null && (
            <ReferenceLine x={gapLabel} stroke={TOKEN_COLORS.expense} label={{ value: t('gapDay'), position: 'insideTopRight', fill: TOKEN_COLORS.expense, fontSize: 12 }} />
          )}
          <Line name={t('balance')} type="monotone" dataKey="actual" stroke={TOKEN_COLORS.brand} strokeWidth={2} dot={false} connectNulls={false} />
          <Line name={t('forecastBalance')} type="monotone" dataKey="forecast" stroke={TOKEN_COLORS.ink} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
