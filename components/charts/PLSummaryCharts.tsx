'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslations } from 'next-intl'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { PLRow } from '@/lib/utils/analytics'
import { TOKEN_COLORS } from '@/lib/ui/colors'
import { cn } from '@/lib/utils'

interface Props {
  rows: PLRow[]
}

// Slice palettes: the income/expense token first, then lighter shades of the same hue.
const COLORS_INCOME = [TOKEN_COLORS.income, '#16a34a', '#4ade80', '#86efac', '#bbf7d0', TOKEN_COLORS.brand]
const COLORS_EXPENSE = [TOKEN_COLORS.expense, '#f87171', '#fca5a5', '#f97316', '#fb923c', '#fecaca']

/** Whole numbers in the UI language. */
function useFormatNum(): (n: number) => string {
  const { number } = useFormatters()
  return (n) => number(n, { maximumFractionDigits: 0 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  const formatNum = useFormatNum()
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-pop text-sm">
      <p className="font-medium text-ink">{item.name}</p>
      <p className="text-ink-muted">{formatNum(item.value)}</p>
      <p className="text-ink-subtle text-xs">{item.payload.percent}%</p>
    </div>
  )
}

function SummaryPie({
  title,
  total,
  rows,
  colors,
  toneClassName,
}: {
  title: string
  total: number
  rows: PLRow[]
  colors: readonly string[]
  /** Text colour utility of the total (`text-income` / `text-expense`). */
  toneClassName: string
}) {
  const formatNum = useFormatNum()
  const data = rows
    .filter((r) => r.total > 0)
    .map((r, i) => ({
      name: r.categoryName,
      value: r.total,
      percent: total > 0 ? Math.round((r.total / total) * 100) : 0,
      fill: colors[i % colors.length],
    }))

  if (!data.length) {
    return (
      <div className="bg-surface rounded-panel border border-line p-6 flex flex-col items-center justify-center h-[260px]">
        <p className="text-ink-muted text-sm">{title}</p>
        <p className="text-2xl font-bold text-ink mt-2">—</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-panel border border-line p-6">
      <p className="text-sm text-ink-muted mb-1">{title}</p>
      <p className={cn('text-2xl font-bold tabular-nums', toneClassName)}>
        {formatNum(total)}
      </p>
      <div className="flex items-center gap-4 mt-4">
        <div className="w-[140px] h-[140px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={66}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {data.slice(0, 6).map((item, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
              <span className="text-xs text-ink-muted truncate flex-1">{item.name}</span>
              <span className="text-xs font-medium text-ink tabular-nums shrink-0">{item.percent}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function PLSummaryCharts({ rows }: Props) {
  const t = useTranslations('charts.plSummary')
  const formatNum = useFormatNum()
  const incomeRows = rows.filter((r) => r.type === 'income')
  const expenseRows = rows.filter((r) => r.type === 'expense')
  const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0)
  const totalExpense = expenseRows.reduce((s, r) => s + r.total, 0)
  const profit = totalIncome - totalExpense

  return (
    <div className="space-y-4">
      {/* Profit banner */}
      <div
        className={cn(
          'rounded-panel border px-6 py-4 flex items-center justify-between',
          profit >= 0 ? 'bg-brand-soft border-brand-soft-hover' : 'bg-expense-soft border-expense-soft',
        )}
      >
        <div>
          <p className="text-sm text-ink-muted">{t('profit')}</p>
          <p className={cn('text-3xl font-bold tabular-nums mt-1', profit >= 0 ? 'text-income' : 'text-expense')}>
            {profit >= 0 ? '+' : ''}{formatNum(profit)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted">{t('margin')}</p>
          <p className={cn('text-xl font-semibold mt-1', profit >= 0 ? 'text-income' : 'text-expense')}>
            {totalIncome > 0 ? Math.round((profit / totalIncome) * 100) : 0}%
          </p>
        </div>
      </div>

      {/* Pie charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryPie
          title={t('incomeByCategory')}
          total={totalIncome}
          rows={incomeRows}
          colors={COLORS_INCOME}
          toneClassName="text-income"
        />
        <SummaryPie
          title={t('expenseByCategory')}
          total={totalExpense}
          rows={expenseRows}
          colors={COLORS_EXPENSE}
          toneClassName="text-expense"
        />
      </div>
    </div>
  )
}
