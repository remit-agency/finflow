'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { EyeOff, SlidersHorizontal } from 'lucide-react'
import { AnalyticsFiltersDialog } from '@/components/analytics/AnalyticsFiltersDialog'
import { TOOLBAR_PILL } from '@/components/analytics/PeriodSelect'
import { activeAnalyticsFilterCount, type AnalyticsFilters, type AnalyticsScope } from '@/lib/domain/analytics-filter/filter'
import { cn } from '@/lib/utils'

interface ButtonProps {
  /** `accounts` on the Balance: only the account field is shown and counted. */
  scope: AnalyticsScope
  value: AnalyticsFilters
  onChange: (next: AnalyticsFilters) => void
}

/** The «Фільтри» pill of a report (S10f) with the number of fields in use; the dialog is mounted only while open. */
export function AnalyticsFiltersButton({ scope, value, onChange }: ButtonProps) {
  const t = useTranslations('analytics.filters')
  const [open, setOpen] = useState(false)
  const count = activeAnalyticsFilterCount(value, scope)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? t('buttonActive', { count }) : t('button')}
        className={cn(TOOLBAR_PILL, count > 0 && 'bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft-hover')}
      >
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        <span>{t('button')}</span>
        {count > 0 && (
          <span
            data-testid="analytics-filters-count"
            aria-hidden
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft-foreground px-1.5 text-xs font-semibold tabular-nums text-white"
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <AnalyticsFiltersDialog
          scope={scope}
          value={value}
          onApply={(next) => {
            onChange(next)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** «Показано також операції, виключені з аналітики»: over a report that counts them because a tag is chosen (S10f). */
export function ExcludedHint() {
  const t = useTranslations('analytics.filters')
  return (
    <p data-testid="analytics-excluded-hint" className="flex items-start gap-2 rounded-field bg-canvas px-3 py-2 text-sm text-ink-muted">
      <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{t('excludedHint')}</span>
    </p>
  )
}
