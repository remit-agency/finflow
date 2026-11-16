'use client'

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ChevronDownIcon } from 'lucide-react'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { PlannedRowLine } from '@/components/recurring/PlannedRowLine'
import { NativeSelect } from '@/components/ui/native-select'
import { upcomingBlock } from '@/lib/domain/recurring/overview'
import { DEFAULT_UPCOMING_PERIOD, UPCOMING_PERIODS, type PlannedRow, type UpcomingPeriod } from '@/lib/domain/recurring/types'
import { usePlanActions } from '@/lib/hooks/usePlanActions'
import { useUpcoming } from '@/lib/hooks/useUpcoming'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { createChoiceStore } from '@/lib/shell/choice-store'
import { createFlagStore } from '@/lib/shell/flag-store'
import { cn } from '@/lib/utils'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** Closed by default, as in Finmap; the choice is remembered in this browser. */
export const UPCOMING_OPEN_KEY = 'finflow:journal-upcoming-open'
const openStore = createFlagStore(UPCOMING_OPEN_KEY, false)
/** The period (1 місяць / 6 місяців / Усе) is remembered in this browser too; 1 місяць at first, as in Finmap. */
export const UPCOMING_PERIOD_KEY = 'finflow:journal-upcoming-period'
const periodStore = createChoiceStore<UpcomingPeriod>(UPCOMING_PERIOD_KEY, DEFAULT_UPCOMING_PERIOD, UPCOMING_PERIODS)

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
 * «Майбутні платежі • N» above the journal (S12d, S12e): the planned payments that are overdue or fall in the chosen period
 * (1 місяць / 6 місяців / Усе), closed behind an arrow so the journal itself is what happened. Opening it shows each payment
 * with «Позначити сплаченою», «Перенести» and «Пропустити»; the whole plan stays on the page «Планові платежі». Shown once the
 * first read is in, empty too: another period may have payments.
 */
export function UpcomingPayments({ orgId, accounts, canEdit, accountId, today }: Props) {
  const t = useTranslations('journal.upcoming')
  const tPlans = useTranslations('journal.plans')
  const { locale } = useFormatters()
  const period = useSyncExternalStore(periodStore.subscribe, periodStore.getSnapshot, periodStore.getServerSnapshot)
  const { read, busy } = useUpcoming(orgId, period)
  const plans = usePlanActions(orgId, today)
  const open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot, openStore.getServerSnapshot)
  const block = useMemo(() => (read ? upcomingBlock(read, accountId) : null), [read, accountId])
  if (read === null || block === null) return null
  const total = read.overdueCount + read.upcomingCount
  const shown = read.overdue.length + read.upcoming.length

  const row = (r: PlannedRow) => (
    <PlannedRowLine
      key={r.id}
      row={r}
      name={(r.seriesId !== undefined ? read.names[r.seriesId] : undefined) ?? r.description ?? tPlans('unnamed')}
      accountName={accounts.find((a) => a.id === r.accountId)?.name ?? '—'}
      dateLabel={formatDayShortUtc(new Date(`${r.paymentDate}T00:00:00Z`), locale)}
      showDate
      today={today}
      canEdit={canEdit}
      plans={plans}
      testId="upcoming-row"
      overdueTestId="upcoming-overdue"
    />
  )

  return (
    <section data-testid="upcoming" aria-labelledby="upcoming-title" aria-busy={busy} className="overflow-hidden rounded-panel border border-line bg-canvas">
      <div className="flex items-center gap-2 pr-3">
        <h2 id="upcoming-title" className="m-0 min-w-0 flex-1 text-sm font-semibold text-ink">
          <button
            type="button"
            data-testid="upcoming-toggle"
            aria-expanded={open}
            aria-controls="upcoming-list"
            onClick={() => openStore.set(!open)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-soft-foreground"
          >
            <span className={cn(busy && 'opacity-60')}>
              {t('title')} <span aria-hidden>•</span> <span data-testid="upcoming-count">{`${block.count}${block.exact ? '' : '+'}`}</span>
            </span>
            <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
          </button>
        </h2>
        <NativeSelect
          data-testid="upcoming-period"
          aria-label={t('period')}
          value={period}
          onChange={(e) => periodStore.set(UPCOMING_PERIODS.find((p) => p === e.target.value) ?? DEFAULT_UPCOMING_PERIOD)}
          className="h-8 text-xs"
        >
          {UPCOMING_PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`periods.${p}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {open && (
        <div id="upcoming-list" className="border-t border-line bg-surface">
          {block.rows.length === 0 ? (
            <p data-testid="upcoming-empty" className="px-4 py-3 text-sm text-ink-muted">
              {t('empty')}
            </p>
          ) : (
            <ul className="divide-y divide-line">{block.rows.map(row)}</ul>
          )}
          <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs">
            <span data-testid="upcoming-partial" className="text-ink-muted">
              {accountId === undefined && shown < total ? t('partial', { shown, count: total }) : ''}
            </span>
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
