'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { NativeSelect } from '@/components/ui/native-select'
import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from '@/lib/i18n/config'
import { writeLocaleCookie } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

/** Remembers the chosen language in the cookie and re-renders the route in it. */
function useChangeLocale() {
  const router = useRouter()
  const current = useLocale()
  const [, startTransition] = useTransition()

  return (next: Locale) => {
    if (next === current) return
    writeLocaleCookie(next)
    startTransition(() => router.refresh())
  }
}

/**
 * `list`: one radio row per language, for the settings section.
 * `select`: a small native select for the auth pages.
 */
export function LanguageSwitcher({ variant }: { variant: 'list' | 'select' }) {
  const t = useTranslations('common')
  const current = useLocale()
  const changeLocale = useChangeLocale()

  if (variant === 'select') {
    return (
      <NativeSelect
        data-testid="language-switcher"
        aria-label={t('language')}
        value={current}
        onChange={(e) => {
          const next = e.target.value
          if (isLocale(next)) changeLocale(next)
        }}
        wrapperClassName="w-32"
        className="h-8 text-xs"
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </NativeSelect>
    )
  }

  return (
    <div role="radiogroup" aria-label={t('language')} className="flex flex-col gap-1.5">
      {LOCALES.map((locale) => {
        const selected = locale === current
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`language-option-${locale}`}
            onClick={() => changeLocale(locale)}
            className={cn(
              'flex items-center justify-between rounded-control border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-soft-foreground',
              selected ? 'border-brand bg-brand-soft text-brand-soft-foreground' : 'border-line text-ink hover:bg-canvas',
            )}
          >
            {LOCALE_LABELS[locale]}
            {selected && <Check className="size-4" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
