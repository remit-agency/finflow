// components/transactions/ExportButton.tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fetchJournalPage } from '@/lib/api/journal-client'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { buildCsv, EXPORT_COLUMNS, exportRow } from '@/lib/domain/journal/csv'
import type { JournalFilters } from '@/lib/domain/journal/filter'
import type { JournalRow } from '@/lib/domain/journal/types'
import type { Tag } from '@/lib/domain/tags/types'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { downloadText, exportFileName } from '@/lib/utils/download'
import { todayDay } from '@/lib/utils/today'
import type { Account, Category } from '@/types'

/** Rows one file may hold; past that the person narrows the filter. */
const MAX_EXPORT_ROWS = 20_000
const EXPORT_PAGE = 100

interface Props {
  orgId: string
  filters: JournalFilters
  accounts: Account[]
  counterparties: Counterparty[]
  incomeCategories: Category[]
  expenseCategories: Category[]
  tags: Tag[]
  baseCurrency: string
}

export function ExportButton({ orgId, filters, accounts, counterparties, incomeCategories, expenseCategories, tags, baseCurrency }: Props) {
  const t = useTranslations('journal.export')
  const { locale } = useFormatters()
  const categoryLabel = useCategoryName()
  const [count, setCount] = useState<number | null>(null)

  const run = async () => {
    const rows: JournalRow[] = []
    let cursor: string | null = null
    setCount(0)
    try {
      do {
        const page = await fetchJournalPage(orgId, filters, cursor, { limit: EXPORT_PAGE })
        rows.push(...page.rows)
        cursor = page.next
        setCount(rows.length)
        if (rows.length > MAX_EXPORT_ROWS) {
          toast.error(t('tooMany', { limit: MAX_EXPORT_ROWS }))
          return
        }
      } while (cursor)
      if (rows.length === 0) {
        toast.info(t('empty'))
        return
      }
      const accountName = new Map(accounts.map((a) => [a.id, a.name]))
      const counterpartyName = new Map(counterparties.map((c) => [c.id, c.name]))
      const categoryName = new Map([...incomeCategories, ...expenseCategories].map((c) => [c.id, categoryLabel(c)]))
      const tagName = new Map(tags.map((tag) => [tag.id, tag.name]))
      const ctx = {
        decimal: locale === 'en' ? ('.' as const) : (',' as const),
        accountName: (id: string) => accountName.get(id) ?? id,
        categoryName: (id: string) => categoryName.get(id) ?? id,
        counterpartyName: (id: string) => counterpartyName.get(id) ?? id,
        tagName: (id: string) => tagName.get(id) ?? id,
        statusLabel: (s: string) => t(`status_${s}` as 'status_actual'),
        typeLabel: (type: string) => t(`type_${type}` as 'type_income'),
        baseCurrency,
      }
      const header = EXPORT_COLUMNS.map((c) => t(`column_${c}`))
      downloadText(exportFileName('journal', todayDay()), buildCsv(header, rows.map((r) => exportRow(r, ctx))))
    } catch {
      toast.error(t('failed'))
    } finally {
      setCount(null)
    }
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={() => void run()} disabled={count !== null} className="gap-1.5 border-line bg-surface text-ink-muted">
      <Download className="size-4" />
      {count === null ? t('button') : t('building', { count })}
    </Button>
  )
}
