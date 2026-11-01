'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { ConfirmDialog } from '@/components/forms/transaction/ConfirmDialog'
import { BulkEditDialog } from '@/components/transactions/BulkEditDialog'
import { ConvertTransferDialog } from '@/components/transactions/ConvertTransferDialog'
import { ExportButton } from '@/components/transactions/ExportButton'
import { JournalFiltersBar } from '@/components/transactions/JournalFilters'
import { SelectionBar, type BulkField } from '@/components/transactions/SelectionBar'
import { TransactionList } from '@/components/transactions/TransactionList'
import { TransferSuggestionsBanner, TransferSuggestionsDialog } from '@/components/transactions/TransferSuggestions'
import { bulkChange, bulkDelete, undoBulkChange, undoBulkDelete } from '@/lib/api/journal-actions'
import { collectMatching, SELECT_ALL_LIMIT } from '@/lib/api/journal-matching'
import { confirmPairs, convertToTransfers, mergeIntoTransfer, undoTransfers } from '@/lib/api/transfers-client'
import { hasActiveFilters } from '@/lib/domain/journal/filter'
import { mostFrequentCode, selectionSummary, type BulkPatch } from '@/lib/domain/journal/selection'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { pairKeyOf } from '@/lib/domain/transfers/dismissed'
import { convertSourceOf, mergePairOf } from '@/lib/domain/transfers/selection'
import type { FailedOutcome, MadeOutcome, TransferOutcome, TransferSuggestion } from '@/lib/domain/transfers/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useJournal } from '@/lib/hooks/useJournal'
import { useJournalSelection } from '@/lib/hooks/useJournalSelection'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { useTransferSuggestions } from '@/lib/hooks/useTransferSuggestions'
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
  const tTransfers = useTranslations('journal.transfers')
  const { money } = useFormatters()
  const { orgId, org, accounts, incomeCategories, expenseCategories, selectedAccountId, selectAccount, can } = useShell()
  const { counterparties } = useCounterparties(orgId)
  const { tags } = useTags(orgId)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The view (period and filters) lives in the address; the account is the shell's selection (sidebar and
  // toolbar select share it) and never goes into the address.
  const query = searchParams.toString()
  const urlView = useMemo(() => viewFromParams(new URLSearchParams(query), todayUtcDay()), [query])
  const filters = useMemo(() => ({ ...urlView.filters, accountId: selectedAccountId ?? undefined }), [urlView, selectedAccountId])
  const view: JournalView = { filters, period: urlView.period }

  const { rows, loading, error, hasMore, loadingMore, moreError, loadMore } = useJournal(orgId, filters)
  const scope = `${orgId}|${query}|${selectedAccountId ?? ''}`
  const selection = useJournalSelection(scope)

  // «Select all matching the filter»: the rows it took beyond the loaded ones (the page needs the whole operation of
  // every selected row for a bulk change, delete or undo). They belong to the selection's scope and are dropped with it.
  const [matching, setMatching] = useState<{
    scope: string
    running: boolean
    done: boolean
    limitReached: boolean
    rows: ReadonlyMap<string, LedgerTransaction>
  } | null>(null)
  if (matching && matching.scope !== scope) setMatching(null)
  const matchingNow = matching && matching.scope === scope ? matching : null

  const canEdit = can('data.write')
  const baseCurrency = org?.currency ?? 'PLN'
  const ledgerById = useMemo(() => new Map(rows.map((r) => [r.tx.id, r.tx])), [rows])
  const transactions = useMemo(() => rows.map((r) => toUiTransaction(orgId, r.tx)), [rows, orgId])
  const grouped = useMemo(() => groupTransactionsByDate(transactions), [transactions])
  const balances = useMemo(() => Object.fromEntries(rows.map((r) => [r.tx.id, r.balanceAfterMinor])), [rows])
  const extraRows = matchingNow?.rows
  // The loaded row first (it is the fresher one), then what «select all matching» kept.
  const selectedRows = useMemo(
    () => [...selection.ids].flatMap((id) => ledgerById.get(id) ?? extraRows?.get(id) ?? []),
    [selection.ids, ledgerById, extraRows],
  )
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  const [editField, setEditField] = useState<BulkField | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)

  // Own transfers (S10b): the suggestions banner and its dialog, for the people who may write.
  const suggestions = useTransferSuggestions(canEdit ? orgId : null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestFailures, setSuggestFailures] = useState<ReadonlyMap<string, string>>(new Map())

  // «Зробити переказом» and «Об’єднати в переказ» are offered only for a selection the ledger's own rules accept.
  const [convertOpen, setConvertOpen] = useState(false)
  const convertSource = useMemo(() => convertSourceOf(selectedRows), [selectedRows])
  const mergePair = useMemo(() => mergePairOf(selectedRows), [selectedRows])
  const sourceAccount = convertSource ? (accounts.find((a) => a.id === convertSource.accountId) ?? null) : null

  const matchRun = useRef<AbortController | null>(null)
  const latest = useRef({ scope, selection })
  useEffect(() => {
    latest.current = { scope, selection }
  })
  // Another scope (or leaving the page) ends a walk in progress.
  useEffect(() => () => matchRun.current?.abort(), [scope])

  const clearSelection = () => {
    matchRun.current?.abort()
    selection.clear()
    setMatching(null)
  }

  const selectMatching = async () => {
    matchRun.current?.abort()
    const ac = new AbortController()
    matchRun.current = ac
    setMatching({ scope, running: true, done: false, limitReached: false, rows: new Map() })
    try {
      const found = await collectMatching(orgId, filters, { signal: ac.signal })
      if (ac.signal.aborted || latest.current.scope !== scope) return
      latest.current.selection.add(found.rows.map((r) => r.id))
      setMatching({ scope, running: false, done: true, limitReached: found.limitReached, rows: new Map(found.rows.map((r) => [r.id, r])) })
    } catch {
      if (ac.signal.aborted) return
      setMatching(null)
      toast.error(t('loadError'))
    } finally {
      if (matchRun.current === ac) matchRun.current = null
    }
  }

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

  // «2 не вдалося: <the most frequent reason>.»
  const failureReason = (failed: { code: string }[]) => errorText(mostFrequentCode(failed) ?? 'unknown')

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
        report.failed.length ? tBulk('resultFailed', { count: report.failed.length, reason: failureReason(report.failed) }) : '',
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
      clearSelection()
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
    const ac = new AbortController()
    setAbort(ac)
    setBusy(true)
    setProgress({ done: 0, total: selectedRows.length })
    try {
      const report = await bulkDelete(selectedRows, {
        orgId,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
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
      if (report.failed.length) toast.warning(tDelete('failed', { count: report.failed.length, reason: failureReason(report.failed) }))
      clearSelection()
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
      setProgress(null)
      setAbort(null)
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

  // One toast for every transfer action (S10b): what was made, what failed and why, the tags that did not fit. «Скасувати»
  // splits what was made and writes its operations back as they were.
  const announceTransfers = (results: TransferOutcome[], message: string) => {
    const made = results.filter((r): r is MadeOutcome => r.ok)
    const failed = results.filter((r): r is FailedOutcome => !r.ok)
    const dropped = made.reduce((sum, r) => sum + r.droppedTags, 0)
    const text = [
      message,
      failed.length > 0 ? tTransfers('partial', { count: failed.length, reason: failureReason(failed) }) : '',
      dropped > 0 ? tTransfers('droppedTags', { count: dropped }) : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (made.length === 0) {
      toast.warning(text)
      return
    }
    undoToast({
      message: text,
      actionLabel: tTransfers('undo'),
      failureMessage: tTransfers('undoFailed'),
      id: 'journal-transfers',
      duration: BULK_UNDO_MS,
      undo: async () => {
        const out = await undoTransfers(orgId, made)
        if (out.failed > 0) throw new Error('partial')
        toast.success(tTransfers('undone', { count: out.done }))
      },
    })
  }

  const openSuggestions = () => {
    setSuggestFailures(new Map())
    setSuggestOpen(true)
    // The dialog shows what the server says now: the operations may have changed since the journal opened.
    suggestions.refresh()
  }

  // «Підтвердити вибрані»: the ticked pairs become transfers; the unticked ones are not offered again in this browser. A pair
  // that fails stays in the dialog with its reason; the dialog closes when every pair went through.
  const confirmSuggested = async (chosen: TransferSuggestion[], rejected: TransferSuggestion[]) => {
    suggestions.dismiss(rejected)
    if (chosen.length === 0) {
      setSuggestOpen(false)
      return
    }
    setBusy(true)
    try {
      const results = await confirmPairs(orgId, chosen)
      announceTransfers(results, tTransfers('done', { count: results.filter((r) => r.ok).length }))
      // The pairs that went through leave the dialog now: a second confirmation must not send them again.
      suggestions.settle(results)
      const failures = new Map<string, string>()
      for (const r of results) if (!r.ok) failures.set(pairKeyOf(r.ids[0], r.ids[1]), errorText(r.code))
      setSuggestFailures(failures)
      if (failures.size === 0) setSuggestOpen(false)
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const convertSelected = async (toAccountId: string) => {
    setBusy(true)
    try {
      const results = await convertToTransfers(orgId, selectedRows.map((r) => r.id), toAccountId)
      announceTransfers(results, tTransfers('converted', { ok: results.filter((r) => r.ok).length, total: results.length }))
      clearSelection()
      setConvertOpen(false)
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const mergeSelected = async () => {
    if (!mergePair) return
    setBusy(true)
    try {
      const result = await mergeIntoTransfer(orgId, [mergePair[0].id, mergePair[1].id])
      announceTransfers([result], result.ok ? tTransfers('merged') : '')
      if (result.ok) clearSelection()
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
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
        tags={tags}
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
              tags={tags}
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

      {canEdit && suggestions.pairs.length > 0 && <TransferSuggestionsBanner count={suggestions.pairs.length} onOpen={openSuggestions} />}

      {canEdit && selectedRows.length > 0 && (
        <SelectionBar
          rows={selectedRows}
          baseCurrency={baseCurrency}
          onEdit={setEditField}
          onDelete={() => setConfirmDelete(true)}
          onClear={clearSelection}
          onConvert={convertSource && sourceAccount && !busy ? () => setConvertOpen(true) : undefined}
          onMerge={mergePair && !busy ? () => void mergeSelected() : undefined}
          matching={{
            offer: hasMore && !matchingNow?.done,
            running: !!matchingNow?.running,
            limitReached: !!matchingNow?.limitReached,
            limit: SELECT_ALL_LIMIT,
          }}
          onSelectMatching={() => void selectMatching()}
        />
      )}

      <TransactionList
        grouped={grouped}
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        counterparties={counterparties}
        tags={tags}
        orgId={orgId}
        loading={loading}
        filtered={hasActiveFilters(filters)}
        balances={balances}
        canSelect={canEdit}
        selection={selection}
        hasMore={hasMore}
        loadingMore={loadingMore}
        moreError={moreError}
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
          tags={tags}
          busy={busy}
          progress={progress}
          onApply={(patch) => void applyChange(patch)}
          onStop={() => abort?.abort()}
          onClose={() => setEditField(null)}
        />
      )}

      {canEdit && convertOpen && sourceAccount && (
        <ConvertTransferDialog
          source={sourceAccount}
          accounts={accounts}
          count={selectedRows.length}
          busy={busy}
          onApply={(toAccountId) => void convertSelected(toAccountId)}
          onClose={() => setConvertOpen(false)}
        />
      )}

      {canEdit && suggestOpen && (
        <TransferSuggestionsDialog
          pairs={suggestions.pairs}
          accounts={accounts}
          truncated={suggestions.truncated}
          busy={busy}
          failures={suggestFailures}
          onConfirm={(chosen, rejected) => void confirmSuggested(chosen, rejected)}
          onClose={() => setSuggestOpen(false)}
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
        progress={progress ? tBulk('progress', { done: progress.done, total: progress.total }) : null}
        stopLabel={tBulk('stop')}
        onStop={() => abort?.abort()}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
