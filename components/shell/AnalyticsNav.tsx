'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsPath } from '@/lib/shell/analytics-sections'
import { cn } from '@/lib/utils'

// The reports of the Analytics module as small pills (the module tabs' look, one size down).
export function AnalyticsNav() {
  const t = useTranslations('shell')
  const { orgId } = useShell()
  const active = activeAnalyticsSection(usePathname(), orgId)

  return (
    <nav aria-label={t('nav.analytics')}className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {ANALYTICS_SECTIONS.map((section) => {
        const isActive = section.slug === active
        return (
          <Link
            key={section.slug}
            href={analyticsPath(orgId, section.slug)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground',
              isActive ? 'bg-ink text-white' : 'bg-canvas text-ink-muted hover:text-ink',
            )}
          >
            {t(`analyticsSections.${section.slug}`)}
          </Link>
        )
      })}
    </nav>
  )
}
