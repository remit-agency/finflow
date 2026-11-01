'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fromMinor } from '@/lib/domain/ledger/money'
import { pairKey } from '@/lib/domain/transfers/dismissed'
import type { SuggestionSide, TransferSuggestion } from '@/lib/domain/transfers/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** «Знайдено можливих переказів…» over the journal (S10b): opens the dialog of suggested pairs. */
export function TransferSuggestionsBanner({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useTranslations('journal.transfers')
  return (
    <div
      data-testid="transfer-suggestions"
      className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-brand-soft px-4 py-2.5 text-sm text-brand-soft-foreground"
    >
      <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t('banner', { count })}</span>
      <Button type="button" variant="soft" size="sm" onClick={onOpen}>
        {t('bannerOpen')}
      </Button>
    </div>
  )
}

interface DialogProps {
  pairs: TransferSuggestion[]
  accounts: Account[]
  truncated: boolean
  busy: boolean
  /** Why a pair failed on the last confirmation (already translated), by pair key: such a pair stays with its reason. */
  failures: ReadonlyMap<string, string>
  /** The ticked pairs, and the unticked ones (turned down in this browser). */
  onConfirm: (chosen: TransferSuggestion[], rejected: TransferSuggestion[]) => void
  onClose: () => void
}

/** The suggested pairs (S10b): every pair starts ticked; «Підтвердити вибрані» merges the ticked ones, «Не зараз» closes. */
export function TransferSuggestionsDialog({ pairs, accounts, truncated, busy, failures, onConfirm, onClose }: DialogProps) {
  const t = useTranslations('journal.transfers')
  const { locale, money } = useFormatters()
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const nameOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—'
  const dayOf = (day: string): string => formatDayShortUtc(new Date(`${day}T00:00:00Z`), locale)
  const amountOf = (side: SuggestionSide): string => money(fromMinor(side.amountMinor), side.currency)
  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const chosen = pairs.filter((p) => !unticked.has(pairKey(p)))
  const rejected = pairs.filter((p) => unticked.has(pairKey(p)))

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      {/* The one column may not grow to the widest nowrap line of a pair: a long name would run past the frame on a phone. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {pairs.map((p) => {
            const key = pairKey(p)
            const from = nameOf(p.from.accountId)
            const to = nameOf(p.to.accountId)
            const dates = p.from.paymentDate === p.to.paymentDate ? dayOf(p.from.paymentDate) : `${dayOf(p.from.paymentDate)} → ${dayOf(p.to.paymentDate)}`
            const failure = failures.get(key)
            return (
              <li key={key} data-testid="transfer-suggestion" className="rounded-field border border-line px-3 py-2">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-brand"
                    checked={!unticked.has(key)}
                    onChange={() => toggle(key)}
                    aria-label={t('pick', { from, to, amount: amountOf(p.from), date: dates })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-ink">{`${from} → ${to}`}</span>
                    <span className="block text-xs tabular-nums text-ink-muted">{dates}</span>
                    {p.from.remittance && <span className="block truncate text-xs text-ink-muted">{p.from.remittance}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{amountOf(p.from)}</span>
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
