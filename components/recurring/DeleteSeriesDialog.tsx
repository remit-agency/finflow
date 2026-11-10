'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { FutureMode } from '@/lib/domain/recurring/types'

/** «Видалити серію»: the future unpaid plans go too by default (spec); paid and past operations always stay. */
export function DeleteSeriesDialog({ name, busy, onConfirm, onClose }: { name: string; busy: boolean; onConfirm: (future: FutureMode) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [deleteFuture, setDeleteFuture] = useState(true)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="break-words">{t('remove.title', { name })}</DialogTitle>
          <DialogDescription>{t('remove.body')}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input id="delete-future" type="checkbox" className="accent-brand" checked={deleteFuture} onChange={(e) => setDeleteFuture(e.target.checked)} />
          {t('remove.future')}
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="destructive" data-testid="delete-confirm" disabled={busy} onClick={() => onConfirm(deleteFuture ? 'delete' : 'keep')}>
            {t('remove.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
