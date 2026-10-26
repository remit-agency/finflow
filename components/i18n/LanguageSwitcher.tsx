'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { NativeSelect } from '@/components/ui/native-select'
import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from '@/lib/i18n/config'
import { writeLocaleCookie } from '@/lib/i18n/client'

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
 * `menu`: items for the profile dropdown (render inside DropdownMenuContent).
 * `select`: a small native select for the auth pages.
 */
export function LanguageSwitcher({ variant }: { variant: 'menu' | 'select' }) {
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
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
      {LOCALES.map((locale) => (
        <DropdownMenuItem
          key={locale}
          data-testid={`language-option-${locale}`}
          onClick={() => changeLocale(locale)}
        >
          {LOCALE_LABELS[locale]}
          {locale === current && <Check className="ml-auto" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
