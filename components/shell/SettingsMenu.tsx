'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { useShell } from '@/lib/hooks/useShell'
import { activeSettingsSection, settingsPath, visibleSettingsSections } from '@/lib/shell/settings-sections'
import { cn } from '@/lib/utils'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-brand-soft-foreground'

// The settings screen's own navigation (as in Finmap, settings replace the whole left column).
// `panel`: the desktop left column (AppShell, from 1024 px). `pills`: the phone row on top of the
// settings content (settings/layout.tsx, below 1024 px). Only one of them is displayed at a time,
// so there is always exactly one visible «Розділи налаштувань» landmark.
export function SettingsMenu({ variant }: { variant: 'panel' | 'pills' }) {
  const t = useTranslations('shell')
  const { orgId, role } = useShell()
  const pathname = usePathname()
  const active = activeSettingsSection(pathname, orgId)
  const sections = visibleSettingsSections(role)

  const back = (
    <Link
      href={`/${orgId}/transactions`}
      className={cn(
        'inline-flex items-center gap-2 rounded-control text-sm font-medium transition-colors',
        variant === 'panel'
          ? 'self-start bg-canvas px-3 py-2 text-ink hover:bg-line'
          : '-ml-1 px-1 py-1 text-ink-muted hover:bg-canvas hover:text-ink',
        FOCUS,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('settingsMenu.back')}
    </Link>
  )

  if (variant === 'pills') {
    return (
      <div className="space-y-3 lg:hidden">
        {back}
        <nav aria-label={t('nav.settings')} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {sections.map((section) => {
            const isActive = section.slug === active
            return (
              <Link
                key={section.slug}
                href={settingsPath(orgId, section.slug)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-ink text-white' : 'bg-canvas text-ink-muted hover:text-ink',
                  FOCUS,
                )}
              >
                {t(`settingsSections.${section.slug}`)}
              </Link>
            )
          })}
        </nav>
      </div>
    )
  }

  return (
    <div data-testid="settings-menu" className="flex h-full w-72 flex-col overflow-y-auto border-r border-line p-3">
      {back}
      <p className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('settingsMenu.title')}</p>
      <nav aria-label={t('nav.settings')} className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const isActive = section.slug === active
          return (
            <Link
              key={section.slug}
              href={settingsPath(orgId, section.slug)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-soft text-brand-soft-foreground' : 'text-ink hover:bg-canvas',
                FOCUS,
              )}
            >
              {t(`settingsSections.${section.slug}`)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
