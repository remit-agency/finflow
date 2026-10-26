import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { LOCALE_COOKIE } from '@/lib/i18n/config'
import { resolveLocale } from '@/lib/i18n/negotiate'

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  })
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: 'Europe/Warsaw',
  }
})
