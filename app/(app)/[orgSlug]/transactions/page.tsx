'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { ConfirmDialog } from '@/components/forms/transaction/ConfirmDialog'
import { BulkEditDialog } from '@/components/transactions/BulkEditDialog'
import { ExportButton } from '@/components/transactions/ExportButton'
import { JournalFiltersBar } from '@/components/transactions/JournalFilters'
import { SelectionBar, type BulkField } from '@/components/transactions/SelectionBar'
import { TransactionList } from '@/components/transactions/TransactionList'
import { bulkChange, bulkDelete, undoBulkChange, undoBulkDelete } from '@/lib/api/journal-actions'
import { selectionSummary, type BulkPatch } from '@/lib/domain/journal/selection'
import { fromMinor } from '@/lib/domain/ledger/money'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useJournal } from '@/lib/hooks/useJournal'
import { useJournalSelection } from '@/lib/hooks/useJournalSelection'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { undoToast } from '@/lib/ui/undo-toast'
import { cn } from '@/lib/utils'
import { groupTransactionsByDate } from '@/lib/utils/date'
import { viewFromParams, viewToParams, type JournalView } from '@/lib/utils/journal-url'
import { todayDay, todayUtcDay } from '@/lib/utils/today'
import type { Transaction } from '@/types'

/** A bulk undo stays longer than a single one: there is more to check. */
const BULK_UNDO_MS = 15_000

export default function TransactionsPage() {
  const t = useTranslations('journal')
  const tBulk = useTranslations('journal.bulk')
  const tDelete = useTranslations('journal.delete')
  const { money } = useFormatters()
  const { orgId, org, accounts, incomeCategories, expenseCategories, selectedAccountId, selectAccount, can } = useShell()
  const { counterparties } = useCounterparties(orgId)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The view (period and filters) lives in the address; the account is the shell's selection (sidebar and
  // toolbar select share it) and never goes into the address.
  const query = searchParams.toString()
  const urlView = useMemo(() => viewFromParams(new URLSearchParams(query), todayUtcDay()), [query])
  const filters = useMemo(() => ({ ...urlView.filters, accountId: selectedAccountId ?? undefined }), [urlView, selectedAccountId])
  const view: JournalView = { filters, period: urlView.period }

  const { rows, loading, error, hasMore, loadingMore, loadMore } = useJournal(orgId, filters)
  const selection = useJournalSelection(`${orgId}|${query}|${selectedAccountId ?? ''}`)

  const canEdit = can('data.write')
  const baseCurrency = org?.currency ?? 'PLN'
  const ledgerById = useMemo(() => new Map(rows.map((r) => [r.tx.id, r.tx])), [rows])
  const transactions = useMemo(() => rows.map((r) => toUiTransaction(orgId, r.tx)), [rows, orgId])
  const grouped = useMemo(() => groupTransactionsByDate(transactions), [transactions])
  const balances = useMemo(() => Object.fromEntries(rows.map((r) => [r.tx.id, r.balanceAfterMinor])), [rows])
  const selectedRows = useMemo(() => [...selection.ids].flatMap((id) => ledgerById.get(id) ?? []), [selection.ids, ledgerById])
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  const [editField, setEditField] = useState<BulkField | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)

  const setView = (next: JournalView) => {
    // The account is the shell's value: the toolbar select changes it there, not in the address.
    if (next.filters.accountId !== (selectedAccountId ?? undefined)) selectAccount(next.filters.accountId ?? null)
    const params = viewToParams(next).toString()
    router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false })
  }

  const errorText = (code: string) => {
    const key = `errors.${code}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

  const applyChange = async (patch: BulkPatch) => {
    const ac = new AbortController()
    setAbort(ac)
    setBusy(true)
    setProgress({ done: 0, total: selectedRows.length })
    try {
      const report = await bulkChange(selectedRows, patch, {
        today: todayDay(),
        orgId,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const message = [
        tBulk('result', { ok: report.applied.length, total: selectedRows.length }),
        report.failed.length ? tBulk('resultFailed', { count: report.failed.length }) : '',
      ]
        .filter(Boolean)
        .join(' ')
      if (report.applied.length > 0) {
        undoToast({
          message,
          actionLabel: tBulk('undo'),
          failureMessage: tBulk('undoFailed'),
          id: 'journal-bulk',
          duration: BULK_UNDO_MS,
          undo: async () => {
            const out = await undoBulkChange(report.applied, { orgId })
            if (out.failed > 0) throw new Error('partial')
            toast.success(tBulk('undone', { count: out.done }))
          },
        })
      } else {
        toast.warning(message)
      }
      selection.clear()
      setEditField(null)
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
      setProgress(null)
      setAbort(null)
    }
  }

  const deleteSelected = async () => {
    setBusy(true)
    try {
      const report = await bulkDelete(selectedRows, { orgId })
      const count = report.applied.length
      if (count > 0) {
        undoToast({
          message: tDelete('done', { count }),
          actionLabel: tDelete('undo'),
          failureMessage: tDelete('undoFailed'),
          id: 'journal-bulk',
          duration: BULK_UNDO_MS,
          undo: async () => {
            const out = await undoBulkDelete(report.applied, { orgId })
            if (out.failed > 0) throw new Error('partial')
            toast.success(tDelete('restored', { count: out.done }))
          },
        })
      }
      if (report.failed.length) toast.warning(tBulk('resultFailed', { count: report.failed.length }))
      selection.clear()
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  // A «вкажіть» chip: one value on one row, through the same bulk endpoint. A refusal is shown and rethrown
  // so the chip's popover stays open.
  const fill = async (tx: Transaction, field: 'category' | 'counterparty', value: string) => {
    const row = ledgerById.get(tx.id)
    if (!row) return
    const patch: BulkPatch = field === 'category' ? { categoryId: value } : { counterpartyId: value }
    try {
      const report = await bulkChange([row], patch, { today: todayDay(), orgId })
      if (report.failed.length) throw new Error(report.failed[0].code)
    } catch (e) {
      toast.error(errorText(e instanceof Error ? e.message : 'unknown'))
      throw e
    }
  }

  const summary = selectionSummary(selectedRows, baseCurrency)

  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-4 pt-2 lg:pt-2')}>
      {/* The active tab already names the page; the heading stays for screen readers. */}
      <h1 className="sr-only">{t('title')}</h1>

      <JournalFiltersBar
        view={view}
        onChange={setView}
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        counterparties={counterparties}
        accessory={
          <>
            {selectedAccount && (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft pr-1.5 pl-3 text-sm font-medium text-brand-soft-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: selectedAccount.color }} />
                <span className="max-w-40 truncate">{selectedAccount.name}</span>
                <button
                  type="button"
                  onClick={() => selectAccount(null)}
                  aria-label={t('showAllAccounts')}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-soft-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            <ExportButton
              orgId={orgId}
              filters={filters}
              accounts={accounts}
              counterparties={counterparties}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
              baseCurrency={baseCurrency}
            />
          </>
        }
      />

      {error && (
        <p role="alert" className="rounded-control bg-expense-soft px-3 py-2 text-sm text-expense">
          {t('loadError')}
        </p>
      )}

      {canEdit && selectedRows.length > 0 && (
        <SelectionBar rows={selectedRows} baseCurrency={baseCurrency} onEdit={setEditField} onDelete={() => setConfirmDelete(true)} onClear={selection.clear} />
      )}

      <TransactionList
        grouped={grouped}
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        counterparties={counterparties}
        orgId={orgId}
        loading={loading}
        balances={balances}
        canSelect={canEdit}
        selection={selection}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onFill={fill}
      />

      {canEdit && editField && (
        <BulkEditDialog
          field={editField}
          rows={selectedRows}
          today={todayDay()}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          counterparties={counterparties}
          busy={busy}
          progress={progress}
          onApply={(patch) => void applyChange(patch)}
          onStop={() => abort?.abort()}
          onClose={() => setEditField(null)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={tDelete('title', { count: selectedRows.length })}
        body={tDelete('body', { amount: money(fromMinor(summary.totalBaseMinor), baseCurrency) })}
        confirmLabel={tDelete('confirm')}
        cancelLabel={tDelete('cancel')}
        destructive
        busy={busy}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
