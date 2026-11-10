'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { confirmMatches, undoMatches } from '@/lib/api/recurring-client'
import { mostFrequentCode } from '@/lib/domain/journal/selection'
import { fromMinor } from '@/lib/domain/ledger/money'
import { keyOfMatch } from '@/lib/domain/recurring/match'
import type { MatchOutcome, PlanMatch } from '@/lib/domain/recurring/types'
import { usePlanMatches } from '@/lib/hooks/usePlanMatches'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { undoToast } from '@/lib/ui/undo-toast'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** Bank operations that look like planned payments (S11): a banner over the journal and its dialog. Mounted for people who may write. */
export function PlanMatches({ orgId, accounts }: { orgId: string; accounts: Account[] }) {
  const t = useTranslations('journal.plans')
  const tBulk = useTranslations('journal.bulk')
  const matches = usePlanMatches(orgId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map())

  const errorText = (code: string): string => {
    const key = `errors.${code}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

  const announce = (results: MatchOutcome[]) => {
    const made = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok) as Array<Extract<MatchOutcome, { ok: false }>>
    const text = [t('done', { count: made.length }), failed.length > 0 ? t('partial', { count: failed.length, reason: errorText(mostFrequentCode(failed) ?? 'unknown') }) : '']
      .filter(Boolean)
      .join(' ')
    if (made.length === 0) {
      toast.warning(text)
      return
    }
    undoToast({
      message: text,
      actionLabel: t('undo'),
      failureMessage: t('undoFailed'),
      id: 'journal-plan-matches',
      undo: async () => {
        const out = await undoMatches(orgId, made.map((r) => r.planId))
        if (out.some((r) => !r.ok)) throw new Error('partial')
        toast.success(t('undone', { count: out.length }))
      },
    })
  }

  const openDialog = () => {
    setFailures(new Map())
    setOpen(true)
    // The dialog shows what the server says now: the operations may have changed since the journal opened.
    matches.refresh()
  }

  // «Підтвердити вибрані»: the ticked pairs are linked; the unticked ones are not offered again in this browser. A pair that
  // fails stays in the dialog with its reason; the dialog closes when every pair went through.
  const confirm = async (chosen: PlanMatch[], rejected: PlanMatch[]) => {
    matches.dismiss(rejected)
    if (chosen.length === 0) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      const results = await confirmMatches(orgId, chosen)
      announce(results)
      matches.settle(results)
      const failed = new Map<string, string>()
      for (const r of results) {
        const pair = chosen.find((p) => p.plan.id === r.planId)
        if (!r.ok && pair !== undefined) failed.set(keyOfMatch(pair), errorText(r.code))
      }
      setFailures(failed)
      if (failed.size === 0) setOpen(false)
    } catch {
      toast.error(errorText('unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {matches.pairs.length > 0 && (
        <div data-testid="plan-matches" className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-brand-soft px-4 py-2.5 text-sm text-brand-soft-foreground">
          <CalendarCheck aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('banner', { count: matches.pairs.length })}</span>
          <Button type="button" variant="soft" size="sm" onClick={openDialog}>
            {t('bannerOpen')}
          </Button>
        </div>
      )}
      {open && (
        <PlanMatchesDialog
          pairs={matches.pairs}
          accounts={accounts}
          truncated={matches.truncated}
          busy={busy}
          failures={failures}
          onConfirm={(chosen, rejected) => void confirm(chosen, rejected)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface DialogProps {
  pairs: PlanMatch[]
  accounts: Account[]
  truncated: boolean
  busy: boolean
  /** Why a pair failed on the last confirmation (already translated), by `keyOfMatch`. */
  failures: ReadonlyMap<string, string>
  onConfirm: (chosen: PlanMatch[], rejected: PlanMatch[]) => void
  onClose: () => void
}

/** The suggested pairs: every pair starts ticked; «Підтвердити вибрані» links the ticked ones, «Не зараз» closes. */
function PlanMatchesDialog({ pairs, accounts, truncated, busy, failures, onConfirm, onClose }: DialogProps) {
  const t = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const dayOf = (day: string): string => formatDayShortUtc(new Date(`${day}T00:00:00Z`), locale)
  const accountOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—'
  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const chosen = pairs.filter((p) => !unticked.has(keyOfMatch(p)))
  const rejected = pairs.filter((p) => unticked.has(keyOfMatch(p)))

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      {/* The one column may not grow to the widest nowrap line of a pair: a long name would run past the frame on a phone. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {pairs.map((p) => {
            const key = keyOfMatch(p)
            const name = p.plan.name ?? p.plan.description ?? t('unnamed')
            const amount = money(fromMinor(p.bank.amountMinor), p.bank.currency)
            const failure = failures.get(key)
            return (
              <li key={key} data-testid="plan-match" className="rounded-field border border-line px-3 py-2">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-brand"
                    checked={!unticked.has(key)}
                    onChange={() => toggle(key)}
                    aria-label={t('pick', { name, planDate: dayOf(p.plan.paymentDate), bankDate: dayOf(p.bank.paymentDate), amount })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-ink">{name}</span>
                    <span className="block text-xs tabular-nums text-ink-muted">
                      {`${t('planLabel', { date: dayOf(p.plan.paymentDate) })} · ${t('bankLabel', { date: dayOf(p.bank.paymentDate) })} · ${accountOf(p.bank.accountId)}`}
                    </span>
                    {p.bank.remittance && <span className="block truncate text-xs text-ink-muted">{p.bank.remittance}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums text-ink">{amount}</span>
                    {p.plan.estimated && <span className="block text-xs text-ink-muted">{t('estimated')}</span>}
                  </span>
                </label>
                {failure && (
                  <p role="alert" className="mt-1 text-xs text-expense">
                    {t('failedPair', { reason: failure })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        {truncated && <p className="text-sm text-ink-muted">{t('truncated')}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('later')}
          </Button>
          <Button type="button" disabled={busy || pairs.length === 0} onClick={() => onConfirm(chosen, rejected)}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
