'use client'

import { useTranslations } from 'next-intl'
import type { Coverage } from '@/lib/domain/reports/types'
import { useFormatters } from '@/lib/i18n/useFormatters'

/** A report the server refused (more operations than it reads: «звузьте період») or could not give (with a retry). */
export function ReportNotice({ kind, cap, onRetry }: { kind: 'too_large' | 'error'; cap?: number; onRetry?: () => void }) {
  const t = useTranslations('reports')
  const { number } = useFormatters()
  if (kind === 'too_large') {
    return (
      <p role="status" data-testid="report-too-large" className="rounded-field border border-line bg-surface px-4 py-3 text-sm text-ink">
        {t('tooLarge', { cap: number(cap ?? 0) })}
      </p>
    )
  }
  return (
    <div role="alert" data-testid="report-error" className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface px-4 py-3 text-sm text-ink">
      <span className="min-w-0">{t('error')}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-control px-3 py-1.5 font-medium text-brand-soft-foreground hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand-soft-foreground"
        >
          {t('retry')}
        </button>
      )}
    </div>
  )
}

/** Where the figures came from (the response's `source`) and, when some were read but could not be counted, how many. */
export function ReportSource({ coverage }: { coverage: Coverage }) {
  const t = useTranslations('reports')
  const { number } = useFormatters()
  return (
    <p data-testid="report-source" data-source={coverage.source} className="text-xs text-ink-subtle">
      {coverage.source === 'rollups' ? t('source.rollups') : t('source.operations', { count: number(coverage.operationsRead) })}
      {coverage.uncountable !== null && coverage.uncountable > 0 && (
        <>
          {' · '}
          <span data-testid="report-uncountable" className="text-expense">{t('uncountable', { count: number(coverage.uncountable) })}</span>
        </>
      )}
    </p>
  )
}
