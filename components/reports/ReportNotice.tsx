'use client'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { viewOfFailure } from '@/lib/api/reports-client'
import type { PeriodProblem } from '@/lib/domain/reports/errors'
import { MAX_REPORT_DAYS, type Coverage } from '@/lib/domain/reports/types'
import { useFormatters } from '@/lib/i18n/useFormatters'

/**
 * A report the server refused (more data than it reads at once: «звузьте період»), an address the page cannot ask for (a period
 * that ends before it starts, or longer than a report covers: `reason`), or a report it could not give (with a retry).
 */
export function ReportNotice({ kind, cap, reason, onRetry }: { kind: 'too_large' | 'invalid' | 'busy' | 'error'; cap?: number; reason?: PeriodProblem; onRetry?: () => void }) {
  const t = useTranslations('reports')
  const { number } = useFormatters()
  if (kind === 'too_large') {
    return (
      <p role="status" data-testid="report-too-large" className="rounded-field border border-line bg-surface px-4 py-3 text-sm text-ink">
        {t('tooLarge', { cap: number(cap ?? 0) })}
      </p>
    )
  }
  if (kind === 'busy') {
    return (
      <p role="status" data-testid="report-busy" className="rounded-field border border-line bg-surface px-4 py-3 text-sm text-ink">
        {t('busy')}
        {onRetry && (
          <button type="button" onClick={onRetry} className="ms-3 rounded-control px-3 py-1.5 font-medium text-brand-soft-foreground hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand-soft-foreground">
            {t('retry')}
          </button>
        )}
      </p>
    )
  }
  if (kind === 'invalid') {
    return (
      <p role="status" data-testid="report-invalid-period" className="rounded-field border border-line bg-surface px-4 py-3 text-sm text-ink">
        {reason === 'order' ? t('periodOrder') : t('periodTooLong', { days: number(MAX_REPORT_DAYS) })}
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

/**
 * The toast of an export that failed: the server's own sentence when it refused the size (the same as the page's notice),
 * the generic one otherwise (S12).
 */
export function useExportFailure(): (e: unknown) => void {
  const t = useTranslations('reports')
  const { number } = useFormatters()
  return (e: unknown) => {
    const view = viewOfFailure(e)
    toast.error(view.status === 'too_large' ? t('tooLarge', { cap: number(view.cap) }) : view.status === 'busy' ? t('busy') : t('exportFailed'))
  }
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
