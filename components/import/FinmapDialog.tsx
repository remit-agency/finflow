'use client'

import { useEffect, useReducer, useRef, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { countAlreadyImported, runFinmapImport, type FinmapResult } from '@/lib/api/finmap-client'
import { MAX_COUNTERPARTIES } from '@/lib/domain/counterparties/types'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import {
  accountSettingOf,
  canRetry,
  canRun,
  finmapDialogReducer,
  initialFinmapState,
  matchedAccountsOf,
  newAccountCurrencies,
  setupAccounts,
  type FinmapDialogState,
  type FinmapError,
  type FinmapEvent,
  type NewAccountSetting,
} from '@/lib/domain/import/finmap/state'
import { batchRefusalTextKey, stopTextKey } from '@/lib/domain/import/finmap/codes'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import {
  MAX_FINMAP_BYTES,
  type ColumnKey,
  type FinmapExisting,
  type FinmapOptions,
  type FinmapPlan,
  type FinmapRefusal,
  type FinmapRow,
  type PlannedOp,
} from '@/lib/domain/import/finmap/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { MAX_TAGS } from '@/lib/domain/tags/types'
import { useAccounts } from '@/lib/hooks/useAccounts'
import { useCategories } from '@/lib/hooks/useCategories'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { todayDay } from '@/lib/utils/today'
import { FinmapAccountRows } from './FinmapAccountRows'

interface Props {
  orgId: string
  onClose: () => void
}

type State = FinmapDialogState<FinmapResult>
type Event = FinmapEvent<FinmapResult>

const reduce = (state: State, event: Event): State => finmapDialogReducer(state, event)

/** Lets the browser paint the phase text before a step that runs on the main thread (the reading and the planning). */
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

const planOptions = (state: State, today: string): FinmapOptions => ({
  includePlanned: state.includePlanned,
  pairTransfers: state.pairTransfers,
  today,
  newAccountCurrency: newAccountCurrencies(state),
})

/** The refusal reasons, in the order the preview lists them. */
const FINMAP_REFUSALS: readonly FinmapRefusal[] = ['date', 'amount', 'account', 'name', 'planned_off', 'accrual_after_horizon']

/** The Polish header names of the columns a file must have: the file's own text, shown so the user can find them. */
const REQUIRED_COLUMN_KEYS: Partial<Record<ColumnKey, 'columns.paymentDate' | 'columns.amountAccount' | 'columns.from' | 'columns.to'>> = {
  paymentDate: 'columns.paymentDate',
  amountAccount: 'columns.amountAccount',
  from: 'columns.from',
  to: 'columns.to',
}

/**
 * Imports a Finmap «Płatności» export (S14b): read the file, plan it, show the preview, choose the new accounts' settings, run. The
 * handlers derive the plan (no effect does); the reducer decides the phase (`lib/domain/import/finmap/state.ts`).
 */
export function FinmapDialog({ orgId, onClose }: Props) {
  const t = useTranslations('import.finmap')
  const tCommon = useTranslations('common')
  const { org } = useShell()
  const { number } = useFormatters()
  const companyCurrency = org?.currency ?? 'PLN'

  const { accounts, loading: accountsLoading } = useAccounts(orgId)
  const { incomeCategories, expenseCategories, loading: categoriesLoading } = useCategories(orgId, { seed: false })
  const { counterparties, loading: counterpartiesLoading } = useCounterparties(orgId)
  const { tags, loading: tagsLoading } = useTags(orgId)
  const dataLoading = accountsLoading || categoriesLoading || counterpartiesLoading || tagsLoading

  const [state, dispatch] = useReducer(reduce, companyCurrency, (currency) => initialFinmapState<FinmapResult>(currency))
  const busy = state.phase === 'reading' || state.phase === 'planning' || state.phase === 'running'

  // The parsed rows of the file: kept out of the state (large, and only planning reads them).
  const rowsRef = useRef<FinmapRow[] | null>(null)
  // The other shape of the current plan's rows (pairing flipped): set with the plan, read by the duplicate check and the run.
  const alternativeRef = useRef<PlannedOp[] | null>(null)
  // Every read, plan or run bumps it: a step that finishes after a newer one stops without dispatching.
  const generation = useRef(0)
  const checkAbort = useRef<AbortController | null>(null)
  const runAbort = useRef<AbortController | null>(null)

  // Closing the dialog stops what it still does: the duplicate check, and a run (its batches are idempotent). A step that
  // finishes after the unmount dispatches to nothing.
  useEffect(() => {
    return () => {
      checkAbort.current?.abort()
      runAbort.current?.abort()
    }
  }, [])

  /** What FinFlow has now, by name. Archived items are included: the setup matches them as well. */
  const existingNow = (): FinmapExisting => ({
    companyCurrency,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    categories: [...incomeCategories, ...expenseCategories].map((c) => ({ id: c.id, name: c.name, type: c.type, ...(c.parentId ? { parentId: c.parentId } : {}) })),
    counterparties: counterparties.map((c) => ({ id: c.id, name: c.name, archived: c.archived })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, archived: tag.archived })),
  })

  /** The «already imported» count of a fresh plan, when some of its accounts exist. The next plan cancels it. */
  const startCheck = (plan: FinmapPlan, existing: FinmapExisting, alternative: PlannedOp[], gen: number) => {
    checkAbort.current?.abort()
    const controller = new AbortController()
    checkAbort.current = controller
    countAlreadyImported(orgId, plan, existing, {
      alternative,
      signal: controller.signal,
      onProgress: (done, total) => {
        if (gen === generation.current) dispatch({ type: 'checkProgress', done, total })
      },
    })
      .then((alreadyImported) => {
        if (gen === generation.current) dispatch({ type: 'checked', alreadyImported })
      })
      .catch(() => {
        if (gen === generation.current) dispatch({ type: 'checkStopped' })
      })
  }

  /** Plans the parsed rows with the options of `from`, after the browser has painted the phase text. */
  const planAfterPaint = async (from: State, gen: number) => {
    await yieldToBrowser()
    const rows = rowsRef.current
    if (gen !== generation.current || rows === null) return
    const existing = existingNow()
    const options = planOptions(from, todayDay())
    const plan = planFinmap(rows, existing, options)
    // The same rows the other way (pairing flipped): their keys are what an import of the other pairing wrote (see alternativeIndices).
    const alternative = planFinmap(rows, existing, { ...options, pairTransfers: !options.pairTransfers }).operations
    if (gen !== generation.current) return
    alternativeRef.current = alternative
    dispatch({ type: 'planned', plan, have: { tags: existing.tags.length, counterparties: existing.counterparties.length } })
    if (plan.matched.accounts > 0) startCheck(plan, existing, alternative, gen)
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared so that choosing the same file again fires the change event.
    event.target.value = ''
    if (!file) return
    const gen = ++generation.current
    checkAbort.current?.abort()
    rowsRef.current = null
    alternativeRef.current = null
    dispatch({ type: 'fileChosen', fileName: file.name, size: file.size })
    if (file.size > MAX_FINMAP_BYTES) return
    await yieldToBrowser()
    if (gen !== generation.current) return

    let table: string[][]
    try {
      table = readXlsxTable(new Uint8Array(await file.arrayBuffer()))
    } catch {
      if (gen === generation.current) dispatch({ type: 'failed', error: { code: 'not_xlsx' } })
      return
    }
    if (gen !== generation.current) return

    const parsed = parseFinmapTable(table)
    const issue = parsed.issues[0]
    if (issue !== undefined) {
      dispatch({ type: 'failed', error: issue.missing ? { code: issue.code, missing: issue.missing } : { code: issue.code } })
      return
    }
    rowsRef.current = parsed.rows
    dispatch({ type: 'tableRead', rowsRead: parsed.rows.length })
    await planAfterPaint(initialFinmapState<FinmapResult>(companyCurrency), gen)
  }

  /**
   * A switch or a new account's setting changed. The reducer says whether the plan is derived again (a switch, or a currency): then the
   * phase moves to planning and the plan follows after the paint; any other change (a type, a balance) is only stored.
   */
  const change = (event: Event) => {
    const next = reduce(state, event)
    if (next.phase !== 'planning') {
      dispatch(event)
      return
    }
    const gen = ++generation.current
    checkAbort.current?.abort()
    dispatch(event)
    void planAfterPaint(next, gen)
  }

  const run = () => {
    const alternative = alternativeRef.current
    if (state.plan === null || alternative === null || !(canRun(state) || canRetry(state))) return
    const plan = state.plan
    const controller = new AbortController()
    runAbort.current = controller
    dispatch({ type: 'runStarted' })
    void runFinmapImport(orgId, {
      fileName: state.fileName ?? '',
      plan,
      alternative,
      accounts: setupAccounts(state),
      existing: existingNow(),
      ...(state.importId === null ? {} : { importId: state.importId }),
      onImportId: (importId) => dispatch({ type: 'importIdKnown', importId }),
      onProgress: (done, total) => dispatch({ type: 'progress', done, total }),
      signal: controller.signal,
    })
      .then((result) => dispatch({ type: 'finished', result }))
      .catch(() => dispatch({ type: 'failed', error: { code: 'failed' } }))
      .finally(() => {
        runAbort.current = null
      })
  }

  /** The text of a dialog error. A run that stopped after a result is shown in the result block instead. */
  const errorText = (error: FinmapError): string => {
    switch (error.code) {
      case 'unknown_layout': {
        const columns = (error.missing ?? []).map((key) => {
          const label = REQUIRED_COLUMN_KEYS[key]
          return label === undefined ? key : t(label)
        })
        return t('error.unknown_layout', { columns: columns.join(', ') })
      }
      case 'empty':
        return t('error.empty')
      case 'too_many_rows':
        return t('error.too_many_rows')
      case 'not_xlsx':
        return t('error.not_xlsx')
      case 'too_big':
        return t('error.too_big')
      case 'too_many_entities':
        return t('error.too_many_entities')
      case 'company_limit':
        return t(error.limit === 'tags' ? 'error.companyLimit.tags' : 'error.companyLimit.counterparties', { max: number(error.limit === 'tags' ? MAX_TAGS : MAX_COUNTERPARTIES) })
      case 'busy':
        return t('error.busy')
      case 'failed':
        return t('error.failed')
    }
  }

  const { plan } = state
  const switchesLocked = state.phase !== 'choosing'

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="finmap-file" className="text-sm text-ink-muted">
            {t('pickFile')}
          </label>
          <input
            id="finmap-file"
            data-testid="finmap-file"
            type="file"
            accept=".xlsx"
            disabled={busy || dataLoading}
            onChange={(event) => void onFile(event)}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
          />
        </div>

        {state.phase === 'reading' && (
          <p role="status" className="text-sm text-ink-muted">
            {t('reading')}
          </p>
        )}
        {state.phase === 'planning' && (
          <p role="status" className="text-sm text-ink-muted">
            {t('planning')}
          </p>
        )}
        {state.error !== null && state.result === null && (
          <p role="alert" data-testid="finmap-error" className="rounded-control bg-expense-soft px-3 py-2 text-sm text-expense">
            {errorText(state.error)}
          </p>
        )}

        {plan && (
          <FinmapPreview
            plan={plan}
            matchedAccounts={matchedAccountsOf(plan, accounts)}
            rowsRead={state.rowsRead}
            alreadyImported={state.alreadyImported}
            checking={state.checking}
            includePlanned={state.includePlanned}
            pairTransfers={state.pairTransfers}
            locked={switchesLocked}
            onOption={(patch) => change({ type: 'optionChanged', ...patch })}
          />
        )}

        {plan && (
          <FinmapAccountRows
            names={plan.create.accounts}
            settingOf={(name) => accountSettingOf(state, name)}
            disabled={switchesLocked}
            onChange={(name, patch: Partial<NewAccountSetting>) => change({ type: 'accountChanged', name, patch })}
          />
        )}

        {state.phase === 'running' && state.progress && (
          <p role="status" className="text-sm text-ink-muted tabular-nums">
            {t('progress', { done: number(state.progress.done), total: number(state.progress.total) })}
          </p>
        )}

        {state.result && <FinmapResultBlock result={state.result} plan={plan} accounts={accounts} stopped={state.error} />}

        <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 flex-wrap gap-2 border-t border-line bg-surface px-4 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          {state.phase === 'running' && (
            <Button type="button" data-testid="finmap-stop" variant="outline" onClick={() => runAbort.current?.abort()}>
              {t('stop')}
            </Button>
          )}
          {canRetry(state) && (
            <Button type="button" data-testid="finmap-retry" variant="outline" onClick={run}>
              {t('retry')}
            </Button>
          )}
          <Button type="button" data-testid="finmap-run" disabled={!canRun(state) || dataLoading} onClick={run}>
            {t('run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type WarningKey = 'commentCut' | 'subcounterparty' | 'project' | 'accrualIgnored' | 'categoryIgnored' | 'archivedMatched'

interface PreviewProps {
  plan: FinmapPlan
  /** The accounts FinFlow already has that the plan uses, with their currency. */
  matchedAccounts: Array<{ name: string; currency: string }>
  rowsRead: number | null
  alreadyImported: number | null
  checking: { done: number; total: number } | null
  includePlanned: boolean
  pairTransfers: boolean
  locked: boolean
  onOption: (patch: { includePlanned?: boolean; pairTransfers?: boolean }) => void
}

/** What the file would do, counted: nothing is written here. */
function FinmapPreview({ plan, matchedAccounts, rowsRead, alreadyImported, checking, includePlanned, pairTransfers, locked, onOption }: PreviewProps) {
  const t = useTranslations('import.finmap')
  const { date, number } = useFormatters()
  const c = plan.counts
  const refused = FINMAP_REFUSALS.filter((reason) => (c.refused[reason] ?? 0) > 0)
  const refusedTotal = refused.reduce((sum, reason) => sum + (c.refused[reason] ?? 0), 0)
  const allWarnings: Array<{ key: WarningKey; n: number }> = [
    { key: 'commentCut', n: c.warnings.commentCut },
    { key: 'subcounterparty', n: c.warnings.subcounterparty },
    { key: 'project', n: c.warnings.project },
    { key: 'accrualIgnored', n: c.warnings.accrualIgnored },
    { key: 'categoryIgnored', n: c.warnings.categoryIgnored },
    { key: 'archivedMatched', n: c.warnings.archivedMatched },
  ]
  const warnings = allWarnings.filter((w) => w.n > 0)
  const subcategories = plan.create.categories.filter((ref) => ref.child !== null).length
  const categories = plan.create.categories.length - subcategories
  const day = (value: string) => date(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium' })

  return (
    <section data-testid="finmap-preview" className="space-y-3 rounded-control border border-line p-4 text-sm text-ink">
      <p className="font-medium">{plan.period ? t('period', { from: day(plan.period.from), to: day(plan.period.to) }) : t('noPeriod')}</p>
      {rowsRead !== null && <p className="text-ink-muted tabular-nums">{t('rowsRead', { n: number(rowsRead) })}</p>}
      <ul className="tabular-nums">
        <li>{t('income', { n: number(c.income) })}</li>
        <li>{t('expense', { n: number(c.expense) })}</li>
        <li>{t('transfer', { n: number(c.transfer) })}</li>
        <li>{t('planned', { n: number(c.planned) })}</li>
      </ul>

      <div className="space-y-1">
        <h3 className="font-medium">{t('createHeading')}</h3>
        <ul className="tabular-nums text-ink-muted">
          <li>{t('createAccounts', { n: number(plan.create.accounts.length) })}</li>
          <li>{t('createCategories', { n: number(categories), sub: number(subcategories) })}</li>
          <li>{t('createCounterparties', { n: number(plan.create.counterparties.length) })}</li>
          <li>{t('createTags', { n: number(plan.create.tags.length) })}</li>
        </ul>
        <p className="text-ink-muted tabular-nums">
          {t('matched', {
            accounts: number(plan.matched.accounts),
            categories: number(plan.matched.categories),
            counterparties: number(plan.matched.counterparties),
            tags: number(plan.matched.tags),
          })}
        </p>
        {matchedAccounts.length > 0 && (
          <div className="text-ink-muted">
            <p>{t('matchedAccountsHint')}</p>
            <ul className="list-inside list-disc tabular-nums">
              {matchedAccounts.map((a) => (
                <li key={a.name}>{t('matchedAccount', { name: a.name, currency: a.currency })}</li>
              ))}
            </ul>
          </div>
        )}
        {alreadyImported !== null && <p className="font-medium tabular-nums">{t('alreadyImported', { n: number(alreadyImported) })}</p>}
        {checking !== null && (
          <p role="status" className="text-ink-muted tabular-nums">
            {t('checking', { done: number(checking.done), total: number(checking.total) })}
          </p>
        )}
      </div>

      {refused.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">{t('refusedHeading', { n: number(refusedTotal) })}</h3>
          <ul className="list-inside list-disc text-ink-muted tabular-nums">
            {refused.map((reason) => (
              <li key={reason}>
                {t(`refusal.${reason}`)}: {number(c.refused[reason] ?? 0)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">{t('warningsHeading')}</h3>
          <ul className="list-inside list-disc text-ink-muted tabular-nums">
            {warnings.map((w) => (
              <li key={w.key}>{t(`warning.${w.key}`, { n: number(w.n) })}</li>
            ))}
          </ul>
        </div>
      )}

      {c.pairCandidatesLeft > 0 && <p className="text-ink-muted tabular-nums">{t('pairCandidatesLeft', { n: number(c.pairCandidatesLeft) })}</p>}

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="finmap-include-planned"
            className="size-4"
            checked={includePlanned}
            disabled={locked}
            onChange={(e) => onOption({ includePlanned: e.target.checked })}
          />
          {t('includePlanned')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="finmap-pair-transfers"
            className="size-4"
            checked={pairTransfers}
            disabled={locked}
            onChange={(e) => onOption({ pairTransfers: e.target.checked })}
          />
          {t('pairTransfers')}
        </label>
      </div>
    </section>
  )
}

interface ResultProps {
  result: FinmapResult
  plan: FinmapPlan | null
  accounts: Array<{ id: string; name: string; currency: string }>
  /** The error of the run that stopped with this result (busy or an error code); null when it completed. */
  stopped: FinmapError | null
}

/** What the run wrote, and why it stopped when it did. */
function FinmapResultBlock({ result, plan, accounts, stopped }: ResultProps) {
  const t = useTranslations('import.finmap')
  const { money, number } = useFormatters()
  const accountOf = (accountId: string) => {
    const known = result.createdAccounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.id === accountId)
    return known ? { name: known.name, currency: known.currency } : null
  }
  const refusedReasons = Object.entries(result.refused.byReason)
  const stoppedBy = result.busy === true ? 'busy' : result.error !== undefined ? 'stopped' : null
  return (
    <section data-testid="finmap-result" className="space-y-2 rounded-control bg-canvas p-3 text-sm text-ink">
      <h3 className="font-medium">{t('resultHeading')}</h3>
      {stoppedBy !== null && stopped !== null && (
        <p role="alert" className="rounded-control bg-expense-soft px-3 py-2 text-expense">
          {stoppedBy === 'busy' ? t('error.busy') : `${t(stopTextKey(result.error ?? ''), { code: result.error ?? '' })} ${t('error.stopped')}`}
        </p>
      )}
      <ul className="tabular-nums">
        <li>{t('created', { n: number(result.created) })}</li>
        <li>{t('skipped', { n: number(result.skipped) })}</li>
        <li>{t('refused', { n: number(result.refused.total) })}</li>
        {result.refused.sample.length > 0 && <li className="text-ink-muted">{t('sample', { n: number(result.refused.sample.length) })}</li>}
        {plan && <li>{t('transfers', { n: number(plan.counts.transfer) })}</li>}
        <li>
          {t('entities', {
            accounts: number(result.entities.accounts),
            categories: number(result.entities.categories),
            counterparties: number(result.entities.counterparties),
            tags: number(result.entities.tags),
          })}
        </li>
        <li>{t('fitted', { n: number(result.fitted) })}</li>
      </ul>
      {refusedReasons.length > 0 && (
        <ul className="list-inside list-disc text-ink-muted tabular-nums">
          {refusedReasons.map(([reason, n]) => (
            <li key={reason}>
              {t(batchRefusalTextKey(reason), { code: reason })}: {number(n)}
            </li>
          ))}
        </ul>
      )}
      {result.differences.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-medium">{t('differencesHeading')}</h4>
          <ul className="tabular-nums">
            {result.differences.flatMap((d) => {
              const account = accountOf(d.accountId)
              return account === null ? [] : [<li key={d.accountId}>{t('difference', { name: account.name, diff: money(fromMinor(d.differenceMinor), account.currency) })}</li>]
            })}
          </ul>
        </div>
      )}
      {result.tagsDropped > 0 && <p className="text-expense tabular-nums">{t('tagsDropped', { n: number(result.tagsDropped) })}</p>}
    </section>
  )
}
