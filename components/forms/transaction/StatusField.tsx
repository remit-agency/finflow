'use client'

import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import type { TxStatus } from '@/lib/domain/ledger/types'

interface Props {
  /** The status that will be saved (a future payment date already forces `planned`). */
  status: TxStatus
  /** The payment date is in the future: «Факт» is not allowed. */
  locked: boolean
  onChange: (status: TxStatus) => void
}

export function StatusField({ status, locked, onChange }: Props) {
  const t = useTranslations('forms.transaction')
  return (
    <div className="space-y-1">
      <Label>{t('status')}</Label>
      <Segmented
        label={t('status')}
        value={status}
        onChange={onChange}
        options={[
          { value: 'actual', label: t('statusActual'), disabled: locked },
          { value: 'planned', label: t('statusPlanned') },
        ]}
      />
      {locked && <p className="text-xs text-ink-muted">{t('statusFutureHint')}</p>}
    </div>
  )
}
