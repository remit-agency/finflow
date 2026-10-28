'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LazyTransactionForm } from '@/components/forms/lazy'
import { useShell } from '@/lib/hooks/useShell'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { formatDayShortUtc, formatWeekdayShortUtc, summarizeDay } from '@/lib/utils/journal'
import type { Transaction, Account, Category } from '@/types'

// Sign and colour of an amount; a transfer moves money between own accounts, so it stays neutral.
const AMOUNT_STYLE: Record<Transaction['type'], { sign: string; className: string }> = {
  income: { sign: '+', className: 'text-income' },
  expense: { sign: '−', className: 'text-expense' },
  transfer: { sign: '', className: 'text-ink-muted' },
}

// Date, Amount, Account, Category, Comment, plus the phone-only trailing Amount cell.
// The day header spans all of them; the browser clamps it to the columns that are visible.
const COLUMN_COUNT = 6

interface TransactionListProps {
  grouped: Record<string, Transaction[]>
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  orgId: string
  loading: boolean
}

export function TransactionList({
  grouped,
  accounts,
  incomeCategories,
  expenseCategories,
  orgId,
  loading,
}: TransactionListProps) {
  const t = useTranslations('journal.list')
  const tAccountTypes = useTranslations('common.accountTypes')
  const { locale, money, date: formatDate } = useFormatters()
  const categoryLabel = useCategoryName()
  const { can, org } = useShell()
  const canEdit = can('data.write')
  const [editTx, setEditTx] = useState<Transaction | null>(null)

  // The amount cell exists twice (a column from `sm`, a trailing cell below it) and both read from here.
  // A transfer between currencies shows what left and what arrived.
  const amountLabel = (tx: Transaction): string => {
    const base = `${AMOUNT_STYLE[tx.type].sign}${money(tx.amount, tx.currency)}`
    const crossCurrency =
      tx.type === 'transfer' && tx.toAmount !== undefined && !!tx.toCurrency && tx.toCurrency !== tx.currency
    return crossCurrency ? `${base} → ${money(tx.toAmount!, tx.toCurrency!)}` : base
  }

  // The group key is a UTC calendar day (`2026-10-23`), formatted in UTC like every stored date.
  const formatGroupKey = (key: string): string => {
    const label = formatDate(new Date(`${key}T00:00:00Z`), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      weekday: 'short',
    })
    // Capitalise only the first letter: the CSS `capitalize` class would also uppercase the month and «р.».
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const allCategories = [...incomeCategories, ...expenseCategories]
  const categoryMap = Object.fromEntries(allCategories.map((c) => [c.id, c]))

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-control bg-canvas" />
        ))}
      </div>
    )
  }

  const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  if (keys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-panel border border-dashed border-line bg-surface py-16 text-center">
        <ReceiptText className="mb-4 size-12 text-ink-subtle" />
        <p className="font-medium text-ink">{t('emptyTitle')}</p>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{t('emptyBody')}</p>
      </div>
    )
  }

  return (
    <>
      {/* Flush in the white shell panel: no card of its own around the table. */}
      <div className="-mx-4 sm:mx-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="hidden w-32 pl-4 sm:table-cell sm:pl-2">{t('date')}</TableHead>
              <TableHead className="hidden w-40 text-right sm:table-cell">{t('amount')}</TableHead>
              <TableHead className="pl-4 sm:pl-6">{t('account')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('category')}</TableHead>
              <TableHead className="hidden pr-2 md:table-cell">{t('comment')}</TableHead>
              <TableHead className="pr-4 text-right sm:hidden">{t('amount')}</TableHead>
            </TableRow>
          </TableHeader>
          {keys.map((dateKey) => {
            const txs = grouped[dateKey]
            // null for a day with several currencies: no sum is better than a wrong one.
            const day = summarizeDay(txs)
            // A day that nets to exactly 0 (e.g. only transfers) stays neutral, without a sign.
            const dayStyle = !day || day.total === 0 ? AMOUNT_STYLE.transfer : day.total > 0 ? AMOUNT_STYLE.income : AMOUNT_STYLE.expense

            return (
              <TableBody key={dateKey} className="[&_tr:last-child]:border-b">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="rowgroup" colSpan={COLUMN_COUNT} className="h-auto px-4 pt-5 pb-2 sm:px-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-ink-muted">{formatGroupKey(dateKey)}</span>
                      {day && (
                        <span className={cn('text-xs font-semibold tabular-nums', dayStyle.className)}>
                          {dayStyle.sign}
                          {money(Math.abs(day.total), day.currency)}
                        </span>
                      )}
                    </div>
                  </TableHead>
                </TableRow>
                {txs.map((tx) => {
                  const amount = AMOUNT_STYLE[tx.type]
                  const account = accountMap[tx.accountId]
                  const toAccount =
                    tx.type === 'transfer' && tx.toAccountId ? accountMap[tx.toAccountId] : null
                  const category = tx.categoryId ? categoryMap[tx.categoryId] : null
                  const categoryName = category
                    ? categoryLabel(category)
                    : tx.type === 'transfer'
                      ? t('transfer')
                      : t('noCategory')
                  const accountLabel = toAccount ? `${account?.name ?? '—'} → ${toAccount.name}` : (account?.name ?? '—')

                  return (
                    // A click anywhere on the row edits it (mouse). Keyboard and screen readers use
                    // the real button in the account cell: the row itself is not a Tab stop.
                    <TableRow
                      key={tx.id}
                      data-status={tx.status === 'planned' ? 'planned' : undefined}
                      onClick={canEdit ? () => setEditTx(tx) : undefined}
                      className={cn(
                        canEdit ? 'cursor-pointer hover:bg-canvas has-[button:focus-visible]:bg-brand-soft' : 'hover:bg-transparent',
                        tx.status === 'planned' && 'text-ink-muted',
                      )}
                    >
                      <TableCell className="hidden py-3.5 pl-4 tabular-nums sm:table-cell sm:pl-2">
                        <span className="block text-ink">{formatDayShortUtc(tx.date, locale)}</span>
                        <span className="block text-xs text-ink-muted">{formatWeekdayShortUtc(tx.date, locale)}</span>
                      </TableCell>
                      <TableCell className={cn('hidden py-3.5 text-right font-semibold tabular-nums sm:table-cell', amount.className)}>
                        {amountLabel(tx)}
                      </TableCell>
                      <TableCell className="py-3.5 pl-4 text-ink sm:pl-6">
                        {/* The account cell is the first cell visible at every width (the date is
                            hidden on a phone), so the row's button lives here. Its name starts with
                            the visible text and adds what tells the rows apart. */}
                        {canEdit ? (
                          <button
                            type="button"
                            aria-label={t('rowEdit', {
                              account: accountLabel,
                              amount: amountLabel(tx),
                              date: formatDayShortUtc(tx.date, locale),
                            })}
                            onClick={(event) => {
                              event.stopPropagation()
                              setEditTx(tx)
                            }}
                            className="block max-w-44 truncate rounded-[4px] text-left text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground sm:max-w-56"
                          >
                            {accountLabel}
                          </button>
                        ) : (
                          <span className="block max-w-44 truncate text-ink sm:max-w-56">{accountLabel}</span>
                        )}
                        {tx.status === 'planned' && <Badge variant="chip" className="mt-1">{t('planned')}</Badge>}
                        {/* Second line: the category below md (its column is hidden there), the account type above. */}
                        <span className="block max-w-44 truncate text-xs text-ink-muted md:hidden">{categoryName}</span>
                        <span className="hidden max-w-56 truncate text-xs text-ink-muted md:block">
                          {account ? tAccountTypes(account.type) : ''}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {category ? (
                          <Badge variant="chip">
                            <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
                            {categoryName}
                          </Badge>
                        ) : tx.type === 'transfer' ? (
                          <Badge variant="chip">{t('transfer')}</Badge>
                        ) : (
                          <span className="text-ink-subtle">{t('noCategory')}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden pr-2 text-ink-muted md:table-cell">
                        <span className="block max-w-72 truncate">{tx.description || '—'}</span>
                      </TableCell>
                      <TableCell className={cn('py-3.5 pr-4 text-right font-semibold tabular-nums sm:hidden', amount.className)}>
                        {amountLabel(tx)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            )
          })}
        </Table>
      </div>

      {canEdit && editTx && (
        <LazyTransactionForm
          orgId={orgId}
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          transaction={editTx}
          defaultCurrency={org?.currency}
          open={!!editTx}
          onClose={() => setEditTx(null)}
        />
      )}
    </>
  )
}
