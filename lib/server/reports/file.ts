import 'server-only'
import { parseNoCategoryId } from '@/lib/domain/analytics-filter/kinds'
import { cashFlowSheets, plSheets, sheetsToCsv, type ExportContext } from '@/lib/domain/reports/export'
import type { AnyReport, ExportFormat } from '@/lib/domain/reports/types'
import { localizeCategoryName } from '@/lib/i18n/category-name'
import type { Locale } from '@/lib/i18n/config'
import { decimalSignOf } from '@/lib/i18n/format'
import { defaultCategoryTranslator, reportExportLabels } from '@/lib/i18n/report-labels'
import { periodKeyLabel } from '@/lib/utils/report-view'
import type { ReportContext } from './read'
import { renderXlsx } from './xlsx'

export interface ReportFile {
  body: string | Uint8Array<ArrayBuffer>
  contentType: string
  filename: string
}

/** The export of a report (S12): built from the same response the page shows, in the language of the request. */
export async function reportFile(report: AnyReport, context: ReportContext, format: ExportFormat, locale: Locale): Promise<ReportFile> {
  const labels = reportExportLabels(locale)
  const t = defaultCategoryTranslator(locale)
  const categories = new Map(context.categories.map((c) => [c.id, c]))
  const accounts = new Map(context.accounts.map((a) => [a.id, a.name]))
  const ctx: ExportContext = {
    labels,
    periodLabel: (key) => periodKeyLabel(key, locale),
    rowName: (row) => {
      const category = parseNoCategoryId(row) === undefined ? categories.get(row) : undefined
      return category ? localizeCategoryName(category, t) : labels.rows.noCategory
    },
    accountName: (id) => accounts.get(id) ?? id,
    categories: context.categories,
  }
  const sheets = report.kind === 'cashflow' ? cashFlowSheets(report, ctx) : plSheets(report, ctx)
  const filename = `${report.kind}-${report.from}_${report.to}.${format}`
  if (format === 'csv') return { body: sheetsToCsv(sheets, decimalSignOf(locale)), contentType: 'text/csv; charset=utf-8', filename }
  return { body: await renderXlsx(sheets), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename }
}
