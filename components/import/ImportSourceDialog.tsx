'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type ImportSource = 'mt940' | 'finmap'

interface Props {
  onClose: () => void
  onChoose: (source: ImportSource) => void
}

/** The first step of «Імпорт»: the file format to import. Each choice opens its own dialog (the caller decides). */
export function ImportSourceDialog({ onClose, onChoose }: Props) {
  const t = useTranslations('import.source')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="import-source" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button type="button" data-testid="import-source-mt940" variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => onChoose('mt940')}>
            <span className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{t('mt940')}</span>
              <span className="text-xs whitespace-normal text-ink-muted">{t('mt940Hint')}</span>
            </span>
          </Button>
          <Button type="button" data-testid="import-source-finmap" variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => onChoose('finmap')}>
            <span className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{t('finmap')}</span>
              <span className="text-xs whitespace-normal text-ink-muted">{t('finmapHint')}</span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
