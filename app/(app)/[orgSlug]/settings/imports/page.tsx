'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/forms/transaction/ConfirmDialog'
import { RequireAction } from '@/components/shell/RequireAction'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { undoImport, type UndoTotals } from '@/lib/api/import-client'
import { canUndo, type ImportView } from '@/lib/domain/import/view'
import { useImports } from '@/lib/hooks/useImports'
import { useShell } from '@/lib/hooks/useShell'
import { useFormatters } from '@/lib/i18n/useFormatters'

export default function ImportsSettingsPage() {
  return (
    <RequireAction action="data.write">
      <ImportsList />
    </RequireAction>
  )
}

function ImportsList() {
  const t = useTranslations('settings.imports')
  const tCommon = useTranslations('common')
  const { orgId } = useShell()
  const { data, last, error } = useImports(orgId)
  const imports = data ?? last
  const [confirming, setConfirming] = useState<ImportView | null>(null)
  // The import being undone and the operations it has deleted so far.
  const [undoing, setUndoing] = useState<{ importId: string; deleted: number } | null>(null)
  const [undoFailed, setUndoFailed] = useState(false)
  // What this browser's undos kept, with the reasons (the server keeps only the counts).
  const [kept, setKept] = useState<Record<string, UndoTotals['kept']>>({})

  const undo = async (row: ImportView) => {
    setConfirming(null)
    setUndoFailed(false)
    setUndoing({ importId: row.id, deleted: 0 })
    try {
      const totals = await undoImport(orgId, row.id, { onProgress: (deleted) => setUndoing({ importId: row.id, deleted }) })
      setKept((prev) => ({ ...prev, [row.id]: totals.kept }))
    } catch {
      setUndoFailed(true)
    } finally {
      setUndoing(null)
    }
  }

  return (
    <Card className="ring-line">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {(error || undoFailed) && (
          <p role="alert" className="mb-3 rounded-control bg-expense-soft px-3 py-2 text-sm text-expense">
            {t('failed')}
          </p>
        )}
        {imports === null ? (
          !error && (
            <p role="status" className="text-sm text-ink-muted">
              {tCommon('loading')}
            </p>
          )
        ) : imports.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {imports.map((row) => (
              <ImportRow
                key={row.id}
                row={row}
                progress={undoing?.importId === row.id ? undoing.deleted : null}
                kept={kept[row.id]}
                disabled={undoing !== null}
                onUndo={() => setConfirming(row)}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        title={t('undo')}
        body={t('undoConfirm')}
        confirmLabel={t('undo')}
        cancelLabel={tCommon('cancel')}
        destructive
        onConfirm={() => {
          if (confirming) void undo(confirming)
        }}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  )
}

function ImportRow({
  row,
  progress,
  kept,
  disabled,
  onUndo,
}: {
  row: ImportView
  /** Operations deleted so far by the undo running now; null when this import is not being undone. */
  progress: number | null
  /** What the undo of this browser kept, when it ran here. */
  kept: UndoTotals['kept'] | undefined
  disabled: boolean
  onUndo: () => void
}) {
  const t = useTranslations('settings.imports')
  const { date } = useFormatters()
  const keptChanged = kept?.filter((k) => k.reason === 'changed').length ?? 0
  return (
    <li data-testid="imports-row" className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-testid="import-kind" className="rounded-control border border-line px-1.5 py-0.5 text-xs text-ink-muted">
            {row.kind === 'finmap' ? t('kind.finmap') : t('kind.mt940')}
          </span>
          <span className="min-w-0 text-sm font-medium break-all text-ink">
            {t('row', { file: row.fileName, created: row.counts.created, date: date(new Date(row.createdAt), { dateStyle: 'medium' }) })}
          </span>
        </span>
        {canUndo(row.status) && (
          <Button type="button" data-testid="import-undo" variant="outline" size="sm" disabled={disabled} onClick={onUndo}>
            {t('undo')}
          </Button>
        )}
      </div>
      {row.status === 'undoing' && <p className="text-sm text-ink-muted">{t('undoing')}</p>}
      {progress !== null && (
        <p role="status" className="text-sm text-ink-muted tabular-nums">
          {t('deleted', { n: progress })}
        </p>
      )}
      {row.kind === 'finmap' && (
        <p data-testid="imports-entities" className="text-sm text-ink-muted tabular-nums">
          {t('entities', {
            accounts: row.entities.accounts,
            categories: row.entities.categories,
            counterparties: row.entities.counterparties,
            tags: row.entities.tags,
          })}
        </p>
      )}
      {row.status === 'undone' && row.undoneAt && (
        <p className="text-sm text-ink-muted tabular-nums">
          {t('undone', { date: date(new Date(row.undoneAt), { dateStyle: 'medium' }), deleted: row.undo.deleted, kept: row.undo.kept })}
        </p>
      )}
      {keptChanged > 0 && <p className="text-sm text-ink-muted tabular-nums">{t('kept', { n: keptChanged })}</p>}
    </li>
  )
}
