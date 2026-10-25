'use client'

import { useMemo } from 'react'
import { useLocale } from 'next-intl'
import { currencySymbol, formatDate, formatMoney, formatNumber, formatWeekday, splitMoney } from './format'
import type { Locale } from './config'

/** The formatters bound to the active UI language (client components). */
export function useFormatters() {
  const locale = useLocale() as Locale
  return useMemo(
    () => ({
      locale,
      money: (amount: number, currency: string) => formatMoney(amount, currency, locale),
      splitMoney: (amount: number, currency: string) => splitMoney(amount, currency, locale),
      currencySymbol: (currency: string) => currencySymbol(currency, locale),
      number: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, locale, options),
      date: (date: Date, options?: Intl.DateTimeFormatOptions) => formatDate(date, locale, options),
      weekday: (date: Date, weekday?: 'short' | 'long') => formatWeekday(date, locale, weekday),
    }),
    [locale],
  )
}
