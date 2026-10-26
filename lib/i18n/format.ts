import { INTL_LOCALE, type Locale } from './config'

// Pure, locale-aware formatting (S03). `locale` is the UI language ('pl' | 'en' | 'uk'); the
// currency comes from the company, never from the language.

function moneyFormat(currency: string, locale: Locale) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency })
}

export function formatMoney(amount: number, currency: string, locale: Locale): string {
  return moneyFormat(currency, locale).format(amount)
}

/**
 * `formatMoney` cut around its decimals, so a big total can show them smaller:
 * `whole` + `fraction` + `rest` is exactly the formatted string. `fraction` is empty for a
 * currency without minor units.
 */
export function splitMoney(amount: number, currency: string, locale: Locale): { whole: string; fraction: string; rest: string } {
  const parts = moneyFormat(currency, locale).formatToParts(amount)
  const decimal = parts.findIndex((part) => part.type === 'decimal')
  if (decimal === -1) return { whole: parts.map((p) => p.value).join(''), fraction: '', rest: '' }
  const fractionEnd = parts[decimal + 1]?.type === 'fraction' ? decimal + 2 : decimal + 1
  const join = (from: number, to?: number) => parts.slice(from, to).map((p) => p.value).join('')
  return { whole: join(0, decimal), fraction: join(decimal, fractionEnd), rest: join(fractionEnd) }
}

/** The sign formatMoney uses for a currency (`€`, `zł`), e.g. as an input suffix. */
export function currencySymbol(currency: string, locale: Locale): string {
  return moneyFormat(currency, locale).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], options).format(value)
}

/**
 * Stored dates are calendar days at 00:00 UTC (see lib/utils/date.ts), so they are formatted in UTC
 * by default: the day never shifts with the viewer's time zone. Pass `timeZone` for real instants.
 */
export function formatDate(date: Date, locale: Locale, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: 'UTC', ...options }).format(date)
}

export function formatWeekday(date: Date, locale: Locale, weekday: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday, timeZone: 'UTC' }).format(date)
}
