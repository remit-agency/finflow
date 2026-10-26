import type { Locale } from '@/lib/i18n/config'
import type uk from './messages/uk.json'

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof uk
  }
}
