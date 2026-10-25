'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { PLRow, formatMonthLabel } from '@/lib/utils/analytics'
import { cn } from '@/lib/utils'

interface PLTableProps {
  rows: PLRow[]
  monthKeys: string[]
  loading?: boolean
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-canvas">
            {Array.from({ length: cols + 2 }).map((_, i) => (
              <th key={i} className="h-10 px-4">
                <div className="h-3 bg-line rounded animate-pulse" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-t border-line">
              {Array.from({ length: cols + 2 }).map((_, j) => (
                <td key={j} className="h-9 px-4">
                  <div className="h-3 bg-canvas rounded animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PLTable({ rows, monthKeys, loading }: PLTableProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { can } = useShell()
  const t = useTranslations('charts.plTable')
  const tCharts = useTranslations('charts')
  const { locale, number } = useFormatters()
  const formatNum = (n: number) => (n === 0 ? '—' : number(n, { maximumFractionDigits: 0 }))
  // "2026-03" -> "Бер 26"
  const monthLabel = (key: string) => {
    const [year, month] = key.split('-')
    return formatMonthLabel(parseInt(year), parseInt(month) - 1, locale)
  }
  if (loading) return <TableSkeleton cols={monthKeys.length} />

  const incomeRows = rows.filter(r => r.type === 'income')
  const expenseRows = rows.filter(r => r.type === 'expense')

  const totalIncome = (key?: string) =>
    incomeRows.reduce((s, r) => s + (key ? (r.months[key] ?? 0) : r.total), 0)
  const totalExpense = (key?: string) =>
    expenseRows.reduce((s, r) => s + (key ? (r.months[key] ?? 0) : r.total), 0)
  const profit = (key?: string) => totalIncome(key) - totalExpense(key)

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-line flex flex-col items-center justify-center gap-2 py-16">
        <p className="text-ink-muted">{tCharts('noData')}</p>
        {can('data.write') && (
          <Link href={`/${orgSlug}/transactions`} className="text-brand-soft-foreground text-sm underline underline-offset-2">
            {tCharts('addTransactions')}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr className="bg-canvas text-ink-muted text-xs uppercase tracking-wide">
            <th className="sticky left-0 z-10 bg-canvas px-4 py-3 text-left font-semibold min-w-[180px]">
              {t('category')}
            </th>
            {monthKeys.map((key) => (
              <th key={key} className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                {monthLabel(key)}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-semibold">{t('total')}</th>
          </tr>
        </thead>
        <tbody>
          {/* INCOME section */}
          <tr className="bg-brand-soft">
            <td
              colSpan={monthKeys.length + 2}
              className="sticky left-0 px-4 py-2 text-xs font-bold text-income uppercase tracking-wide"
            >
              {t('income')}
            </td>
          </tr>
          {incomeRows.map((row) => (
            <tr
              key={row.categoryId}
              className="border-t border-line hover:bg-canvas transition-colors"
            >
              <td className="sticky left-0 z-10 bg-surface hover:bg-canvas px-4 py-2.5 text-ink">
                {row.categoryName}
              </td>
              {monthKeys.map((key) => (
                <td
                  key={key}
                  className="px-4 py-2.5 text-right text-income"
                >
                  {formatNum(row.months[key] ?? 0)}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold text-income">
                {formatNum(row.total)}
              </td>
            </tr>
          ))}
          {/* Income total row */}
          <tr className="border-t-2 border-line bg-brand-soft">
            <td className="sticky left-0 z-10 bg-brand-soft px-4 py-2.5 font-semibold text-ink">
              {t('totalIncome')}
            </td>
            {monthKeys.map((key) => (
              <td key={key} className="px-4 py-2.5 text-right font-semibold text-income">
                {formatNum(totalIncome(key))}
              </td>
            ))}
            <td className="px-4 py-2.5 text-right font-bold text-income">
              {formatNum(totalIncome())}
            </td>
          </tr>

          {/* EXPENSE section */}
          <tr className="bg-expense-soft">
            <td
              colSpan={monthKeys.length + 2}
              className="sticky left-0 px-4 py-2 text-xs font-bold text-expense uppercase tracking-wide"
            >
              {t('expense')}
            </td>
          </tr>
          {expenseRows.map((row) => (
            <tr
              key={row.categoryId}
              className="border-t border-line hover:bg-canvas transition-colors"
            >
              <td className="sticky left-0 z-10 bg-surface hover:bg-canvas px-4 py-2.5 text-ink">
                {row.categoryName}
              </td>
              {monthKeys.map((key) => (
                <td
                  key={key}
                  className="px-4 py-2.5 text-right text-expense"
                >
                  {formatNum(row.months[key] ?? 0)}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold text-expense">
                {formatNum(row.total)}
              </td>
            </tr>
          ))}
          {/* Expense total row */}
          <tr className="border-t-2 border-line bg-expense-soft">
            <td className="sticky left-0 z-10 bg-expense-soft px-4 py-2.5 font-semibold text-ink">
              {t('totalExpense')}
            </td>
            {monthKeys.map((key) => (
              <td key={key} className="px-4 py-2.5 text-right font-semibold text-expense">
                {formatNum(totalExpense(key))}
              </td>
            ))}
            <td className="px-4 py-2.5 text-right font-bold text-expense">
              {formatNum(totalExpense())}
            </td>
          </tr>

          {/* PROFIT / LOSS row */}
          <tr className="border-t-2 border-ink">
            <td className="sticky left-0 z-10 bg-surface px-4 py-3 font-bold text-ink">
              {t('profit')}
            </td>
            {monthKeys.map((key) => {
              const val = profit(key)
              return (
                <td
                  key={key}
                  className={cn('px-4 py-3 text-right font-bold', val >= 0 ? 'text-income' : 'text-expense')}
                >
                  {val >= 0 ? '+' : ''}{formatNum(val)}
                </td>
              )
            })}
            <td className={cn('px-4 py-3 text-right font-bold text-base', profit() >= 0 ? 'text-income' : 'text-expense')}>
              {profit() >= 0 ? '+' : ''}{formatNum(profit())}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
