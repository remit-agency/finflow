'use client'

import { useReducer, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { importStatement, previewImport, type ImportStatementResult } from '@/lib/api/import-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { decodeStatementBytes } from '@/lib/domain/import/decode'
import {
  canRun,
  dialogErrorOf,
  importDialogReducer,
  initialDialogState,
  isBusy,
  needsCount,
  runPlan,
  withAccount,
  type DialogError,
  type RunItem,
  type StatementOutcome,
} from '@/lib/domain/import/dialog-state'
import { MAX_IMPORT_BYTES, MAX_IMPORT_OPS } from '@/lib/domain/import/types'
import type { PreviewStatement } from '@/lib/domain/import/view'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'
import type { Account } from '@/types'
import { REASON_KEY, StatementCard } from './StatementCard'

interface Props {
  orgId: string
  accounts: Account[]
  onClose: () => void
}

/** The server's refusal of a request becomes a dialog error (`dialogErrorOf`); anything else is a plain failure. */
function toDialogError(error: unknown): DialogError {
  if (error instanceof LedgerApiError) return dialogErrorOf(error.status, error.code, error.details)
  return { code: 'failed', line: null }
}

function outcomeOf(item: RunItem, result: ImportStatementResult): StatementOutcome {
  return {
    index: item.index,
    accountId: item.accountId,
    created: result.created,
    skipped: result.skipped,
    refused: result.refused.map((r) => r.reason),
    fitted: result.fitted,
    differenceMinor: result.differenceMinor,
    busy: result.busy,
  }
}

/**
 * Imports a statement file: read, preview, choose an account per statement, count, run. The steps are driven by the handlers
 * below (no effects); the reducer decides the phase (`lib/domain/import/dialog-state.ts`).
 */
export function ImportDialog({ orgId, accounts, onClose }: Props) {
  const t = useTranslations('import')
  const tCommon = useTranslations('common')
  const [state, dispatch] = useReducer(importDialogReducer, initialDialogState)
  const busy = isBusy(state.phase)

  // Counts the statements of the file for `accountIds`: the operations get their statuses and the counts their totals.
  const count = async (text: string, fileName: string, accountIds: Array<string | null>) => {
    try {
      const preview = await previewImport(orgId, { fileName, text, accountIds })
      dispatch({ type: 'counted', preview, accounts: accountIds })
    } catch (error) {
      dispatch({ type: 'failed', error: toDialogError(error) })
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared so that choosing the same file again fires the change event.
    event.target.value = ''
    if (!file) return
    dispatch({ type: 'pick', fileName: file.name, size: file.size })
    if (file.size > MAX_IMPORT_BYTES) return
    try {
      const { text } = decodeStatementBytes(new Uint8Array(await file.arrayBuffer()))
      dispatch({ type: 'decoded', text })
      const preview = await previewImport(orgId, { fileName: file.name, text })
      dispatch({ type: 'previewed', preview })
      // The same rule as the reducer: a suggested account means the statements are counted before the choice.
      const suggested = preview.statements.map((statement) => statement.suggestedAccountId)
      if (suggested.some((accountId) => accountId !== null)) await count(text, file.name, suggested)
    } catch (error) {
      dispatch({ type: 'failed', error: toDialogError(error) })
    }
  }

  const choose = (index: number, accountId: string | null) => {
    if (state.phase !== 'choosing' || state.text === null || state.fileName === null) return
    const next = withAccount(state.accounts, index, accountId)
    dispatch({ type: 'choose', index, accountId })
    if (needsCount(state.countedFor, next)) void count(state.text, state.fileName, next)
  }

  // The statements go one after another, in file order, sharing one import id; a busy account stops the run.
  const run = async () => {
    if (!canRun(state) || state.fileName === null) return
    const plan = runPlan(state)
    const fileName = state.fileName
    dispatch({ type: 'run' })
    let importId: string | undefined
    let done = 0
    try {
      for (const item of plan) {
        const base = done
        const result = await importStatement(orgId, {
          importId,
          fileName,
          accountId: item.accountId,
          statement: item.statement,
          operations: item.operations,
          onProgress: (sent) => dispatch({ type: 'progress', done: base + sent }),
        })
        importId = result.importId ?? importId
        done += item.operations.length
        dispatch({ type: 'outcome', outcome: outcomeOf(item, result) })
        if (result.busy) {
          dispatch({ type: 'failed', error: { code: 'busy', line: null } })
          return
        }
      }
      dispatch({ type: 'finished' })
    } catch (error) {
      dispatch({ type: 'failed', error: toDialogError(error) })
    }
  }

  const errorText = (error: DialogError): string => {
    switch (error.code) {
      case 'too_big':
        return t('tooBig')
      case 'too_many':
        return t('tooMany', { limit: MAX_IMPORT_OPS })
      case 'not_mt940':
        return t('notMt940', { line: error.line ?? '–' })
      case 'busy':
        return t('busy')
      case 'failed':
        return t('failed')
    }
  }

  const { preview } = state
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="import-file" className="text-sm text-ink-muted">
            {t('pickFile')}
          </label>
          <input
            id="import-file"
            data-testid="import-file"
            type="file"
            accept=".sta,.mt940,.txt,text/plain"
            disabled={busy}
            onChange={(event) => void onFile(event)}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
          />
        </div>

        {busy && (
          <p role="status" className="text-sm text-ink-muted">
            {tCommon('loading')}
          </p>
        )}

        {state.phase === 'error' && state.error && (
          <p role="alert" className="rounded-control bg-expense-soft px-3 py-2 text-sm text-expense">
            {errorText(state.error)}
          </p>
        )}

        {state.phase === 'running' && state.progress && (
          <p role="status" className="text-sm text-ink-muted tabular-nums">
            {t('progress', { done: state.progress.done, total: state.progress.total })}
          </p>
        )}

        {preview && (
          <div data-testid="import-statements" className="space-y-3">
            {preview.statements.map((statement, position) => (
              <StatementCard
                key={statement.index}
                statement={statement}
                position={position}
                accounts={accounts}
                accountId={state.accounts[position] ?? null}
                disabled={state.phase !== 'choosing'}
                onChoose={(accountId) => choose(position, accountId)}
              />
            ))}
          </div>
        )}

        {(state.phase === 'done' || state.phase === 'error') && state.outcomes.length > 0 && (
          <section data-testid="import-result" className="space-y-2">
            {state.outcomes.map((outcome) => (
              <ResultLine
                key={outcome.index}
                outcome={outcome}
                statement={preview?.statements[outcome.index]}
                account={accounts.find((a) => a.id === outcome.accountId)}
              />
            ))}
          </section>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" data-testid="import-run" disabled={busy || !canRun(state)} onClick={() => void run()}>
            {t('run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What one statement's write came to. */
function ResultLine({ outcome, statement, account }: { outcome: StatementOutcome; statement: PreviewStatement | undefined; account: Account | undefined }) {
  const t = useTranslations('import')
  const { money } = useFormatters()
  const currency = statement?.currency ?? account?.currency ?? null
  return (
    <div className="space-y-1 rounded-control bg-canvas p-3 text-sm text-ink">
      <p className="font-medium">
        {t('statement', { n: outcome.index + 1 })}
        {account ? ` → ${account.name}` : ''}
      </p>
      {outcome.busy && <p>{t('busy')}</p>}
      <p className="tabular-nums">
        {t('created', { n: outcome.created })} · {t('skippedSeen', { n: outcome.skipped.seen })} · {t('skippedBank', { n: outcome.skipped.bank })} ·{' '}
        {t('refused', { n: outcome.refused.length })}
      </p>
      {outcome.refused.length > 0 && (
        <ul className="list-inside list-disc text-ink-muted">
          {outcome.refused.map((reason, i) => (
            <li key={i}>{t(REASON_KEY[reason])}</li>
          ))}
        </ul>
      )}
      {outcome.fitted && <p>{t('fitted')}</p>}
      {outcome.differenceMinor !== null && outcome.differenceMinor !== 0 && currency && (
        <p className="tabular-nums">{t('difference', { diff: money(fromMinor(outcome.differenceMinor), currency) })}</p>
      )}
    </div>
  )
}
