'use client'

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CalendarClockIcon, CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fromMinor } from '@/lib/domain/ledger/money'
import { upcomingBlock } from '@/lib/domain/recurring/overview'
import { isOverdue } from '@/lib/domain/recurring/rows'
import { UPCOMING_DAYS, type PlannedRow } from '@/lib/domain/recurring/types'
import { usePlanActions } from '@/lib/hooks/usePlanActions'
import { useRecurringOverview } from '@/lib/hooks/useRecurringOverview'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { createFlagStore } from '@/lib/shell/flag-store'
import { cn } from '@/lib/utils'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** Closed by default, as in Finmap; the choice is remembered in this browser. */
export const UPCOMING_OPEN_KEY = 'finflow:journal-upcoming-open'
const openStore = createFlagStore(UPCOMING_OPEN_KEY, false)

interface Props {
  orgId: string
  accounts: Account[]
  canEdit: boolean
  /** The account selected in the sidebar; the block follows it as the list does. */
  accountId?: string
  /** The Warsaw day. */
  today: string
}

/**
 * «Майбутні платежі • N (найближчі 7 днів)» above the journal (S12d): the planned payments that are overdue or fall in the
 * next week, closed behind an arrow so the journal itself is what happened. Opening it shows each payment with «Позначити
 * сплаченою», «Перенести» and «Пропустити»; the whole plan stays on the page «Планові платежі».
 */
export function UpcomingPayments({ orgId, accounts, canEdit, accountId, today }: Props) {
  const t = useTranslations('journal.upcoming')
  const tRec = useTranslations('recurring')
  const tPlans = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  const { overview } = useRecurringOverview(orgId)
  const plans = usePlanActions(orgId, today)
  const open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot, openStore.getServerSnapshot)
  const names = useMemo(() => new Map((overview?.series ?? []).map((s) => [s.id, s.name])), [overview])
  const block = useMemo(() => (overview ? upcomingBlock(overview, today, accountId) : null), [overview, today, accountId])
  if (block === null || block.count === 0) return null

  const row = (r: PlannedRow) => {
    const name = (r.seriesId !== undefined ? names.get(r.seriesId) : undefined) ?? r.description ?? tPlans('unnamed')
    const date = formatDayShortUtc(new Date(`${r.paymentDate}T00:00:00Z`), locale)
    const amount = money(fromMinor(r.amountMinor), r.currency)
    const account = accounts.find((a) => a.id === r.accountId)?.name ?? '—'
    const overdue = isOverdue({ status: 'planned', paymentDate: r.paymentDate }, today)
    const busy = plans.busyId !== null
    return (
      <li key={r.id} data-testid="upcoming-row" data-overdue={overdue || undefined} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
        <span className="w-14 shrink-0 tabular-nums text-ink-muted">{date}</span>
        <span className={cn('w-28 shrink-0 font-medium tabular-nums', r.type === 'income' ? 'text-income' : 'text-ink')}>{amount}</span>
        <span className="min-w-0 flex-1 truncate text-ink">
          {name}
          <span className="text-ink-muted">{` · ${account}`}</span>
        </span>
        <span className="flex gap-1">
          {overdue && (
            <Badge variant="chip" data-testid="upcoming-overdue" className="bg-expense-soft text-expense">
              {tRec('planned.overdue')}
            </Badge>
          )}
          {r.estimated && <Badge variant="chip">{tRec('planned.estimated')}</Badge>}
        </span>
        {canEdit && (
          <span role="group" aria-label={tRec('planned.rowActions', { name, amount, date })} className="flex shrink-0 gap-1">
            <Button type="button" size="icon-sm" variant="soft" disabled={busy} title={tRec('planned.markPaid')} aria-label={tRec('planned.markPaid')} onClick={() => plans.markPaid(r)}>
              <CheckIcon aria-hidden />
            </Button>
            <Button type="button" size="icon-sm" variant="outline" disabled={busy} title={tRec('planned.move')} aria-label={tRec('planned.move')} onClick={() => plans.setMoving(r)}>
              <CalendarClockIcon aria-hidden />
            </Button>
            {r.seriesId !== undefined && r.occurrence !== undefined && (
              <Button type="button" size="icon-sm" variant="outline" disabled={busy} title={tRec('planned.skip')} aria-label={tRec('planned.skip')} onClick={() => plans.skip(r)}>
                <XIcon aria-hidden />
              </Button>
            )}
          </span>
        )}
      </li>
    )
  }

  return (
    <section data-testid="upcoming" aria-labelledby="upcoming-title" className="overflow-hidden rounded-panel border border-line bg-canvas">
      <h2 id="upcoming-title" className="m-0 text-sm font-semibold text-ink">
        <button
          type="button"
          data-testid="upcoming-toggle"
          aria-expanded={open}
          aria-controls="upcoming-list"
          onClick={() => openStore.set(!open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-soft-foreground"
        >
          <span>
            {t('title')} <span aria-hidden>•</span> <span data-testid="upcoming-count">{block.count}</span>{' '}
            <span className="font-normal text-ink-muted">{t('window', { days: UPCOMING_DAYS })}</span>
          </span>
          <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
        </button>
      </h2>
      {open && (
        <div id="upcoming-list" className="border-t border-line bg-surface">
          <ul className="divide-y divide-line">{block.rows.map(row)}</ul>
          <p className="border-t border-line px-4 py-2 text-right text-xs">
            <Link href={`/${orgId}/recurring`} className="text-brand-soft-foreground underline-offset-4 hover:underline">
              {t('all')}
            </Link>
          </p>
        </div>
      )}
      {plans.moving !== null && <MoveDateDialog row={plans.moving} onConfirm={plans.move} onClose={() => plans.setMoving(null)} />}
    </section>
  )
}
