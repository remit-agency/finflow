'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { DeleteSeriesDialog } from '@/components/recurring/DeleteSeriesDialog'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { PauseSeriesDialog } from '@/components/recurring/PauseSeriesDialog'
import { PresetMenu } from '@/components/recurring/PresetMenu'
import { SeriesEditor } from '@/components/recurring/SeriesEditor'
import { Button } from '@/components/ui/button'
import { PlannedList } from '@/components/recurring/PlannedList'
import { RecurringStrip } from '@/components/recurring/RecurringStrip'
import { SeriesList } from '@/components/recurring/SeriesList'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { markPlanPaid, movePlan, skipPlanOccurrence, undoPlanEdit, undoPlanSkip } from '@/lib/api/recurring-actions'
import { deleteSeries, updateSeries } from '@/lib/api/recurring-client'
import type { FutureMode, PlannedRow, Preset, SeriesRow } from '@/lib/domain/recurring/types'
import { useRecurringOverview } from '@/lib/hooks/useRecurringOverview'
import { useShell } from '@/lib/hooks/useShell'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { undoToast } from '@/lib/ui/undo-toast'
import { cn } from '@/lib/utils'
import { todayDay } from '@/lib/utils/today'
import type { Transaction } from '@/types'

// «Планові платежі» (S11): overdue and the next 7 days, the series, the upcoming planned operations with their actions.
export default function RecurringPage() {
  const t = useTranslations('recurring')
  const tBulk = useTranslations('journal.bulk')
  const { orgId, accounts, can } = useShell()
  const canEdit = can('data.write')
  const { overview, error } = useRecurringOverview(orgId)
  const [moving, setMoving] = useState<PlannedRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The series dialogs: one open at a time.
  const [editor, setEditor] = useState<{ series?: SeriesRow; preset?: Preset } | null>(null)
  const [pausing, setPausing] = useState<SeriesRow | null>(null)
  const [deleting, setDeleting] = useState<SeriesRow | null>(null)
  const [seriesBusy, setSeriesBusy] = useState(false)
  const today = todayDay()
  const names = useMemo(() => new Map((overview?.series ?? []).map((s) => [s.id, s.name])), [overview])

  const errorText = (e: unknown): string => {
    const key = `errors.${e instanceof LedgerApiError ? e.code : 'unknown'}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

  // One action at a time; its toast offers «Скасувати» (the edit written back, or the skipped plan re-created).
  const act = async (row: PlannedRow, run: () => Promise<Transaction>, message: string, undo: (before: Transaction) => Promise<void>) => {
    if (busyId !== null) return
    setBusyId(row.id)
    try {
      const before = await run()
      undoToast({ message, actionLabel: t('planned.undo'), failureMessage: t('planned.undoFailed'), id: `plan-${row.id}`, undo: () => undo(before) })
    } catch (e) {
      toast.error(t('planned.failed', { reason: errorText(e) }))
    } finally {
      setBusyId(null)
    }
  }
  const markPaid = (row: PlannedRow) => void act(row, () => markPlanPaid(orgId, row.id, today), t('planned.paid'), (before) => undoPlanEdit(orgId, before))
  const skip = (row: PlannedRow) => {
    const { seriesId, occurrence } = row
    if (seriesId === undefined || occurrence === undefined) return
    void act(row, () => skipPlanOccurrence(orgId, seriesId, occurrence), t('planned.skipped'), (before) => undoPlanSkip(orgId, before))
  }
  const move = (day: string) => {
    const row = moving
    setMoving(null)
    if (row !== null) void act(row, () => movePlan(orgId, row.id, day), t('planned.moved'), (before) => undoPlanEdit(orgId, before))
  }

  const changeSeries = async (run: () => Promise<unknown>, message: string) => {
    if (seriesBusy) return
    setSeriesBusy(true)
    try {
      await run()
      toast.success(message)
      setPausing(null)
      setDeleting(null)
    } catch (e) {
      toast.error(t('planned.failed', { reason: errorText(e) }))
    } finally {
      setSeriesBusy(false)
    }
  }
  const pause = (removeFuture: boolean) => {
    if (pausing !== null) void changeSeries(() => updateSeries(orgId, pausing.id, { status: 'paused', removeFuture }), t('pause.done'))
  }
  const resume = (s: SeriesRow) => void changeSeries(() => updateSeries(orgId, s.id, { status: 'active' }), t('pause.resumed'))
  const remove = (future: FutureMode) => {
    if (deleting !== null) void changeSeries(() => deleteSeries(orgId, deleting.id, future), t('remove.done'))
  }
  const seriesActions = (s: SeriesRow) => (
    <div role="group" aria-label={t('series.actions', { name: s.name })} className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setEditor({ series: s })}>
        {t('series.edit')}
      </Button>
      {s.status === 'active' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setPausing(s)}>
          {t('series.pause')}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={seriesBusy} onClick={() => resume(s)}>
          {t('series.resume')}
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(s)}>
        {t('series.delete')}
      </Button>
    </div>
  )

  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-6')}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 basis-full font-display text-2xl font-semibold text-ink sm:flex-1 sm:basis-0">{t('title')}</h1>
        {canEdit && (
          <>
            <PresetMenu onPick={(preset) => setEditor({ preset })} />
            <Button type="button" data-testid="series-add" onClick={() => setEditor({})}>
              {t('series.add')}
            </Button>
          </>
        )}
      </div>
      {error && overview === null && (
        <p role="alert" className="text-sm text-expense">
          {t('loadError')}
        </p>
      )}
      {overview !== null && (
        <>
          <RecurringStrip overview={overview} />
          <section aria-labelledby="series-title" className="space-y-3">
            <h2 id="series-title" className="text-lg font-semibold text-ink">
              {t('series.title')}
            </h2>
            <SeriesList rows={overview.series} accounts={accounts} actions={canEdit ? seriesActions : undefined} />
          </section>
          <section aria-labelledby="planned-title" className="space-y-3">
            <h2 id="planned-title" className="text-lg font-semibold text-ink">
              {t('planned.title')}
            </h2>
            <PlannedList
              overdue={overview.overdue}
              upcoming={overview.upcoming}
              names={names}
              accounts={accounts}
              canEdit={canEdit}
              today={today}
              busyId={busyId}
              onMarkPaid={markPaid}
              onMove={setMoving}
              onSkip={skip}
            />
            {overview.truncated && <p className="text-sm text-ink-muted">{t('truncated')}</p>}
          </section>
        </>
      )}
      {moving !== null && <MoveDateDialog row={moving} onConfirm={move} onClose={() => setMoving(null)} />}
      {editor !== null && <SeriesEditor orgId={orgId} series={editor.series} preset={editor.preset} onClose={() => setEditor(null)} />}
      {pausing !== null && <PauseSeriesDialog busy={seriesBusy} onConfirm={pause} onClose={() => setPausing(null)} />}
      {deleting !== null && <DeleteSeriesDialog name={deleting.name} busy={seriesBusy} onConfirm={remove} onClose={() => setDeleting(null)} />}
    </div>
  )
}
