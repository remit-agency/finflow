'use client'

import { useTranslations } from 'next-intl'
import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { selectionSummary } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'

export type BulkField = 'category' | 'counterparty' | 'comment' | 'paymentDate' | 'accrual'

const FIELDS: BulkField[] = ['category', 'counterparty', 'comment', 'paymentDate', 'accrual']

interface Props {
  rows: LedgerTransaction[]
  baseCurrency: string
  onEdit: (field: BulkField) => void
  onDelete: () => void
  onClear: () => void
  /** «Select all matching the filter»: offered while more rows match than are loaded. */
  matching: { offer: boolean; running: boolean; limitReached: boolean; limit: number }
  onSelectMatching: () => void
}

/** Appears over the journal while rows are checked: how many, their net amount, «change data» and «delete». */
export function SelectionBar({ rows, baseCurrency, onEdit, onDelete, onClear, matching, onSelectMatching }: Props) {
  const t = useTranslations('journal.selection')
  const { money } = useFormatters()
  const { count, totalBaseMinor } = selectionSummary(rows, baseCurrency)

  return (
    // Dark ink on the brand green (`primary-foreground`, 7.7:1); white on it would be 2.2:1.
    <div
      role="region"
      aria-label={t('region')}
      className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-panel bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-pop max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3"
    >
      <span className="font-semibold">{t('selected', { count })}</span>
      <span className="tabular-nums">{money(fromMinor(totalBaseMinor), baseCurrency)}</span>
      {matching.running ? (
        <span role="status">{t('selecting')}</span>
      ) : matching.limitReached ? (
        <span role="status">{t('limitReached', { limit: matching.limit })}</span>
      ) : (
        matching.offer && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelectMatching}
            className="px-2 text-primary-foreground underline hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            {t('selectAllMatching')}
          </Button>
        )
      )}
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="secondary" size="sm" />}>{t('change')}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FIELDS.map((field) => (
              <DropdownMenuItem key={field} onClick={() => onEdit(field)}>
                {t(`field_${field}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="secondary" size="sm" onClick={onDelete} className="gap-1">
          <Trash2 className="size-3.5" />
          {t('delete')}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} aria-label={t('clear')} className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
