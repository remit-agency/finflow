'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LazyTransactionForm } from '@/components/forms/lazy'
import { FillChip } from '@/components/transactions/FillChip'
import { fetchTransaction } from '@/lib/api/journal-client'
import { notifyLedgerChanged } from '@/lib/api/ledger-events'
import { LedgerApiError } from '@/lib/api/ledger-client'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
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

// Checkbox, Date, Amount, Account, Category, Comment, plus the phone-only trailing Amount cell.
// The day header spans all of them; the browser clamps it to the columns that are visible.
const COLUMN_COUNT = 7

interface TransactionListProps {
  grouped: Record<string, Transaction[]>
  accounts: Account[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  counterparties: Counterparty[]
  orgId: string
  loading: boolean
  /** Any filter, search or period is active: an empty list then means «nothing matches», not «no operations yet». */
  filtered: boolean
  /** Balance of the account after each operation, in minor units; null for a planned one. */
  balances: Record<string, number | null>
  canSelect: boolean
  selection: { has: (id: string) => boolean; toggle: (id: string) => void; add: (ids: string[]) => void; remove: (ids: string[]) => void }
  hasMore: boolean
  loadingMore: boolean
  /** The last «load more» failed: the sentinel stops asking by itself and a button asks again. */
  moreError: boolean
  onLoadMore: () => void
  /** Sets one category or counterparty from a «вкажіть» chip; rejects when the server refused. */
  onFill: (tx: Transaction, field: 'category' | 'counterparty', value: string) => Promise<void>
}

export function TransactionList({
  grouped,
  accounts,
  incomeCategories,
  expenseCategories,
  counterparties,
  orgId,
  loading,
  filtered,
  balances,
  canSelect,
  selection,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
  onFill,
}: TransactionListProps) {
  const t = useTranslations('journal.list')
  const tJournal = useTranslations('journal')
  const tAccountTypes = useTranslations('common.accountTypes')
  const { locale, money, date: formatDate } = useFormatters()
  const categoryLabel = useCategoryName()
  const { can, org } = useShell()
  const canEdit = can('data.write')
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const hasRows = Object.keys(grouped).length > 0

  // A row can be older than the operation (another tab, a bank import, a bulk run): the form opens with the
  // operation as it is now. While the read is in flight further clicks are ignored; if the operation is gone the
  // list reloads, and any other failure opens the form with the row as shown.
  const opening = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      opening.current?.abort()
    },
    [],
  )
  const openEdit = async (tx: Transaction) => {
    if (opening.current) return
    const ac = new AbortController()
    opening.current = ac
    try {
      const fresh = await fetchTransaction(orgId, tx.id, ac.signal)
      if (!ac.signal.aborted) setEditTx(toUiTransaction(orgId, fresh))
    } catch (e) {
      if (ac.signal.aborted) return
      if (e instanceof LedgerApiError && e.status === 404) {
        toast.error(t('gone'))
        notifyLedgerChanged()
      } else {
        setEditTx(tx)
      }
    } finally {
      if (opening.current === ac) opening.current = null
    }
  }

  // The next page loads when the sentinel under the table scrolls near the viewport. `loadingMore` is a
  // dependency so the observer is armed again after a page arrives: a short page that leaves the sentinel
  // in view then loads the next one.
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    // After a failed page the observer stays off (it would re-ask at once and loop); the retry button asks again.
    if (!el || !hasMore || moreError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, loadingMore, moreError, loading, hasRows])

  // The amount cell exists twice (a column from `sm`, a trailing cell below it) and both read from here.
  // A transfer between currencies shows what left and what arrived.
  const amountLabel = (tx: Transaction): string => {
    const base = `${AMOUNT_STYLE[tx.type].sign}${money(tx.amount, tx.currency)}`
    const crossCurrency =
      tx.type === 'transfer' && tx.toAmount !== undefined && !!tx.toCurrency && tx.toCurrency !== tx.currency
    return crossCurrency ? `${base} → ${money(tx.toAmount!, tx.toCurrency!)}` : base
  }

  // The transaction (accrual) date or period shown under the payment date, when it differs from it.
  const accrualText = (tx: Transaction): string | null => {
    if (tx.type === 'transfer') return null
    if (tx.accrual.mode === 'date') {
      return tx.accrual.date === tx.date.toISOString().slice(0, 10)
        ? null
        : t('accrualDate', { value: formatDayShortUtc(new Date(`${tx.accrual.date}T00:00:00Z`), locale) })
    }
    return t('accrualPeriod', {
      from: formatDayShortUtc(new Date(`${tx.accrual.from}T00:00:00Z`), locale),
      to: formatDayShortUtc(new Date(`${tx.accrual.to}T00:00:00Z`), locale),
    })
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
  const counterpartyMap = Object.fromEntries(counterparties.map((c) => [c.id, c]))
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
  const allIds = keys.flatMap((k) => grouped[k].map((tx) => tx.id))

  // Under the table (or under the «searching» message): the sentinel that pages on, the loading hint, the retry.
  const footer = (
    <>
      <div ref={sentinel} aria-hidden className="h-4" />
      {loadingMore && <p className="py-3 text-center text-sm text-ink-muted">{t('loadingMore')}</p>}
      {moreError && !loadingMore && (
        <div className="flex justify-center py-3">
          <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
            {t('loadMoreRetry')}
          </Button>
        </div>
      )}
    </>
  )

  if (keys.length === 0) {
    // The server stops a scan at its cap and answers no rows with a cursor: older operations may still match, so
    // this is not «nothing found» yet. The sentinel keeps paging until rows appear or the cursor runs out.
    if (hasMore) {
      return (
        <>
          <div role="status" className="flex flex-col items-center justify-center rounded-panel border border-dashed border-line bg-surface py-16 text-center">
            <ReceiptText className="mb-4 size-12 text-ink-subtle" />
            <p className="font-medium text-ink">{t('searching')}</p>
          </div>
          {footer}
        </>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center rounded-panel border border-dashed border-line bg-surface py-16 text-center">
        <ReceiptText className="mb-4 size-12 text-ink-subtle" />
        <p className="font-medium text-ink">{filtered ? t('noMatchTitle') : t('emptyTitle')}</p>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{filtered ? t('noMatchBody') : t('emptyBody')}</p>
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
              {canSelect && (
                <TableHead className="w-8 pl-4 sm:pl-2">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    aria-label={t('selectAll')}
                    checked={allIds.length > 0 && allIds.every((id) => selection.has(id))}
                    onChange={(e) => (e.target.checked ? selection.add(allIds) : selection.remove(allIds))}
                  />
                </TableHead>
              )}
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
                  const counterparty = tx.counterpartyId ? counterpartyMap[tx.counterpartyId] : null
                  const categoryName = category
                    ? categoryLabel(category)
                    : tx.type === 'transfer'
                      ? t('transfer')
                      : t('noCategory')
                  const accountLabel = toAccount ? `${account?.name ?? '—'} → ${toAccount.name}` : (account?.name ?? '—')
                  const selected = selection.has(tx.id)
                  const balance = balances[tx.id]
                  const accrual = accrualText(tx)
                  const canFill = canEdit && tx.type !== 'transfer'
                  const showFill = !counterparty && canFill
                  // The bank's name for the other party is only a hint: shown muted until a real counterparty is set.
                  const bankName = !counterparty && tx.bank?.counterpartyName ? tx.bank.counterpartyName : null
                  // The counterparty cell has a line when there is a counterparty, a fill chip or a bank operation (its mark).
                  const counterpartyLine = !!counterparty || showFill || !!tx.bank
                  const planned = tx.status === 'planned'
                  // A planned operation has not moved any money: its amount is neutral grey (the sign stays), not green or red.
                  const amountClass = planned ? 'text-ink-muted' : amount.className

                  return (
                    // A click anywhere on the row edits it (mouse). Keyboard and screen readers use
                    // the real button in the account cell: the row itself is not a Tab stop.
                    <TableRow
                      key={tx.id}
                      data-status={tx.status === 'planned' ? 'planned' : undefined}
                      data-selected={selected || undefined}
                      onClick={canEdit ? () => void openEdit(tx) : undefined}
                      className={cn(
                        canEdit ? 'cursor-pointer hover:bg-canvas has-[button:focus-visible]:bg-brand-soft' : 'hover:bg-transparent',
                        planned && 'text-ink-muted',
                        selected && 'bg-brand-soft hover:bg-brand-soft-hover',
                      )}
                    >
                      {canSelect && (
                        <TableCell className="w-8 py-3.5 pl-4 sm:pl-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="accent-brand"
                            aria-label={t('selectRow', {
                              account: accountLabel,
                              amount: amountLabel(tx),
                              date: formatDayShortUtc(tx.date, locale),
                            })}
                            checked={selected}
                            onChange={() => selection.toggle(tx.id)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="hidden py-3.5 pl-4 tabular-nums sm:table-cell sm:pl-2">
                        <span className="block text-ink">{formatDayShortUtc(tx.date, locale)}</span>
                        <span className="block text-xs text-ink-muted">{formatWeekdayShortUtc(tx.date, locale)}</span>
                        {accrual && <span className="block text-xs text-ink-muted">{accrual}</span>}
                      </TableCell>
                      <TableCell className={cn('hidden py-3.5 text-right font-semibold tabular-nums sm:table-cell', amountClass)}>
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
                              void openEdit(tx)
                            }}
                            className={cn('block max-w-44 truncate rounded-[4px] text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground sm:max-w-56', planned ? 'text-ink-muted' : 'text-ink')}
                          >
                            {accountLabel}
                          </button>
                        ) : (
                          <span className={cn('block max-w-44 truncate sm:max-w-56', planned ? 'text-ink-muted' : 'text-ink')}>{accountLabel}</span>
                        )}
                        {planned && <Badge variant="chip" className="mt-1">{t('planned')}</Badge>}
                        {/* Second line: the category below md (its column is hidden there), the account type above. */}
                        {canEdit && !tx.categoryId && tx.type !== 'transfer' ? (
                          <span className="mt-0.5 block md:hidden">
                            <FillChip
                              field="category"
                              categories={tx.type === 'income' ? incomeCategories : expenseCategories}
                              counterparties={counterparties}
                              onSave={(value) => onFill(tx, 'category', value)}
                            />
                          </span>
                        ) : (
                          <span className="block max-w-44 truncate text-xs text-ink-muted md:hidden">{categoryName}</span>
                        )}
                        <span className="hidden max-w-56 truncate text-xs text-ink-muted md:block">
                          {account ? tAccountTypes(account.type) : ''}
                        </span>
                        {balance != null && account && (
                          <span className="block max-w-56 truncate text-xs tabular-nums text-ink-muted" aria-label={t('balanceAfter')}>
                            {money(fromMinor(balance), account.currency)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {category ? (
                          <Badge variant="chip">
                            <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
                            {categoryName}
                          </Badge>
                        ) : tx.type === 'transfer' ? (
                          <Badge variant="chip">{t('transfer')}</Badge>
                        ) : canEdit && !tx.categoryId ? (
                          <FillChip
                            field="category"
                            categories={tx.type === 'income' ? incomeCategories : expenseCategories}
                            counterparties={counterparties}
                            onSave={(value) => onFill(tx, 'category', value)}
                          />
                        ) : (
                          <span className="text-ink-subtle">{t('noCategory')}</span>
                        )}
                        {tx.autoRules && tx.autoRules.length > 0 && (
                          <span className="mt-1 block">
                            <Badge variant="chip" data-testid="rule-chip" className="font-normal text-ink-muted">
                              {tJournal('byRule', { name: tx.autoRules.map((r) => r.name).join(', ') })}
                            </Badge>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden pr-2 text-ink-muted md:table-cell">
                        {/* One line: the bank mark, then the counterparty (or the bank's name for it, muted), then the «вкажіть» chip. */}
                        {counterpartyLine && (
                          <span className="flex max-w-72 items-center gap-2">
                            {tx.bank && <Badge variant="chip" className="shrink-0">{tJournal('fromBank')}</Badge>}
                            {counterparty ? (
                              <span className="min-w-0 truncate text-ink">{counterparty.name}</span>
                            ) : bankName ? (
                              <span className="min-w-0 truncate text-ink-muted" title={bankName}>
                                {bankName}
                              </span>
                            ) : null}
                            {showFill && (
                              <FillChip
                                field="counterparty"
                                categories={[]}
                                counterparties={counterparties}
                                onSave={(value) => onFill(tx, 'counterparty', value)}
                              />
                            )}
                          </span>
                        )}
                        {/* A dash only when nothing else fills the cell. */}
                        {(tx.description || !counterpartyLine) && (
                          <span className="block max-w-72 truncate">{tx.description || '—'}</span>
                        )}
                      </TableCell>
                      <TableCell className={cn('py-3.5 pr-4 text-right font-semibold tabular-nums sm:hidden', amountClass)}>
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
      {footer}

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
