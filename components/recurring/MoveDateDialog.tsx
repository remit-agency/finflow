'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { PlannedRow } from '@/lib/domain/recurring/types'

/** «Перенести»: a new payment day for one planned operation (it becomes «змінено вручну»). */
export function MoveDateDialog({ row, onConfirm, onClose }: { row: PlannedRow; onConfirm: (day: string) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [day, setDay] = useState(row.paymentDate)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('move.title')}</DialogTitle>
          <DialogDescription>{t('move.body')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="move-date">{t('move.date')}</Label>
          <DateField id="move-date" value={day} onChange={setDay} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('move.cancel')}
          </Button>
          <Button type="button" disabled={day === '' || day === row.paymentDate} onClick={() => onConfirm(day)}>
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
