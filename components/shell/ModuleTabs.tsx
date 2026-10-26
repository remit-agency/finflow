'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { MODULE_TABS, activeModule } from '@/lib/shell/modules'
import { cn } from '@/lib/utils'

// Navigation links styled as large pills (the active module is a dark filled pill, as in Finmap):
// Tab moves between them, Enter follows a link. Sticky at the top of the scrolling content column.
export function ModuleTabs() {
  const t = useTranslations('shell')
  const { orgId } = useShell()
  const pathname = usePathname()
  const active = activeModule(pathname, orgId)

  return (
    <nav
      aria-label={t('nav.modules')}
      className="sticky top-0 z-10 flex shrink-0 items-center gap-1 overflow-x-auto bg-surface px-4 pt-4 pb-3 lg:px-8"
    >
      {MODULE_TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href(orgId)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-4 py-1.5 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground',
              isActive ? 'bg-ink text-white' : 'text-ink-muted hover:bg-canvas hover:text-ink',
            )}
          >
            {t(`modules.${tab.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}
