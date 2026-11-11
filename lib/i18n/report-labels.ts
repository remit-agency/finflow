// lib/i18n/report-labels.ts
// The words of a report file (S12) in a language, for the server that builds it: the `reports.export` zone of the catalogs
// and the default category names (`localizeCategoryName` outside React). No next-intl: the catalogs are plain JSON.
import en from '@/messages/en.json'
import pl from '@/messages/pl.json'
import uk from '@/messages/uk.json'
import type { ExportLabels } from '@/lib/domain/reports/export'
import type { DefaultCategoryKey } from './category-name'
import type { Locale } from './config'

const CATALOGS = { uk, pl, en } as const

export function reportExportLabels(locale: Locale): ExportLabels {
  return CATALOGS[locale].reports.export
}

/** A translator of the default category names (`defaultCategories.<type>.<slug>`) for `localizeCategoryName`. */
export function defaultCategoryTranslator(locale: Locale): (key: DefaultCategoryKey) => string {
  const names = CATALOGS[locale].defaultCategories
  return (key) => {
    const [, type, slug] = key.split('.')
    const group: Record<string, string> = type === 'income' ? names.income : names.expense
    return group[slug] ?? slug
  }
}
