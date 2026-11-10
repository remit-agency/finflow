'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** «Призупинити»: no new plans; the future unpaid ones stay unless the person ticks their removal. */
export function PauseSeriesDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: (removeFuture: boolean) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [removeFuture, setRemoveFuture] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('pause.title')}</DialogTitle>
          <DialogDescription>{t('pause.body')}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input id="pause-remove" type="checkbox" className="accent-brand" checked={removeFuture} onChange={(e) => setRemoveFuture(e.target.checked)} />
          {t('pause.removeFuture')}
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" data-testid="pause-confirm" disabled={busy} onClick={() => onConfirm(removeFuture)}>
            {t('pause.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
