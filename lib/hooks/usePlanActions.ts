'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { markPlanPaid, movePlan, skipPlanOccurrence, undoPlanEdit, undoPlanSkip } from '@/lib/api/recurring-actions'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { undoToast } from '@/lib/ui/undo-toast'
import type { Transaction } from '@/types'

export interface PlanActions {
  /** The row an action is running for: every action waits meanwhile. */
  busyId: string | null
  /** The row whose «Перенести» dialog is open. */
  moving: PlannedRow | null
  setMoving: (row: PlannedRow | null) => void
  markPaid: (row: PlannedRow) => void
  /** Only for a row of a series (the occurrence is what is skipped). */
  skip: (row: PlannedRow) => void
  /** Confirms the open «Перенести» dialog with the chosen day. */
  move: (day: string) => void
}

/**
 * The actions on one planned operation (S11): «Позначити сплаченою», «Перенести», «Пропустити». One at a time; each toast
 * offers «Скасувати» (the edit written back, or the skipped plan re-created). Shared by the page «Планові платежі» and the
 * «Майбутні платежі» block of the journal, so both behave the same.
 */
export function usePlanActions(orgId: string, today: string): PlanActions {
  const t = useTranslations('recurring')
  const tBulk = useTranslations('journal.bulk')
  const [moving, setMoving] = useState<PlannedRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const errorText = (e: unknown): string => {
    const key = `errors.${e instanceof LedgerApiError ? e.code : 'unknown'}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

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

  return {
    busyId,
    moving,
    setMoving,
    markPaid: (row) => void act(row, () => markPlanPaid(orgId, row.id, today), t('planned.paid'), (before) => undoPlanEdit(orgId, before)),
    skip: (row) => {
      const { seriesId, occurrence } = row
      if (seriesId === undefined || occurrence === undefined) return
      void act(row, () => skipPlanOccurrence(orgId, seriesId, occurrence), t('planned.skipped'), (before) => undoPlanSkip(orgId, before))
    },
    move: (day) => {
      const row = moving
      setMoving(null)
      if (row !== null) void act(row, () => movePlan(orgId, row.id, day), t('planned.moved'), (before) => undoPlanEdit(orgId, before))
    },
  }
}
