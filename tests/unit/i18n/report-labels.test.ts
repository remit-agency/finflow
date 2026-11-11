import { describe, expect, it } from 'vitest'
import { localizeCategoryName } from '@/lib/i18n/category-name'
import { decimalSignOf } from '@/lib/i18n/format'
import { defaultCategoryTranslator, reportExportLabels } from '@/lib/i18n/report-labels'

describe('the export words from the catalogs', () => {
  it('the sheet names in each language', () => {
    expect(reportExportLabels('uk').sheets).toEqual({ report: 'Звіт', categories: 'За категоріями', reconciliation: 'Звірка' })
    expect(reportExportLabels('pl').sheets).toEqual({ report: 'Raport', categories: 'Według kategorii', reconciliation: 'Uzgodnienie' })
    expect(reportExportLabels('en').sheets).toEqual({ report: 'Report', categories: 'By category', reconciliation: 'Reconciliation' })
  })

  it('a default category in the language of the file, any other name as stored', () => {
    expect(localizeCategoryName({ name: 'Продажі', type: 'income' }, defaultCategoryTranslator('pl'))).toBe('Sprzedaż')
    expect(localizeCategoryName({ name: 'Sprzedaż', type: 'income' }, defaultCategoryTranslator('en'))).toBe('Sales')
    expect(localizeCategoryName({ name: 'Oprogramowanie', type: 'expense' }, defaultCategoryTranslator('uk'))).toBe('Oprogramowanie')
  })

  it('a decimal comma in Polish and Ukrainian, a point in English', () => {
    expect([decimalSignOf('uk'), decimalSignOf('pl'), decimalSignOf('en')]).toEqual([',', ',', '.'])
  })
})
