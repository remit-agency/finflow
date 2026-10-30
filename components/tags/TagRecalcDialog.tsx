'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RecalcRunError, recalculateTag } from '@/lib/api/tags-client'
import type { Tag } from '@/lib/domain/tags/types'

interface Props {
  orgId: string
  tag: Tag
  onClose: () => void
}

type Phase = { kind: 'running'; scanned: number } | { kind: 'done'; scanned: number } | { kind: 'failed' }

/**
 * Runs the recalculation of a tag's operations on mount, with the progress. Closing stops after the step in flight (a
 * step is safe to repeat); the tag then keeps «Перерахунок не завершено» and the list offers «Продовжити».
 */
export function TagRecalcDialog({ orgId, tag, onClose }: Props) {
  const t = useTranslations('settings.tags.recalc')
  const tCommon = useTranslations('common')
  const [phase, setPhase] = useState<Phase>({ kind: 'running', scanned: 0 })
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    running.current = controller
    recalculateTag(orgId, tag.id, { signal: controller.signal, onProgress: (p) => setPhase({ kind: 'running', scanned: p.scanned }) }).then(
      (totals) => setPhase({ kind: 'done', scanned: totals.scanned }),
      (err: unknown) => {
        if (!controller.signal.aborted && err instanceof RecalcRunError) setPhase({ kind: 'failed' })
      },
    )
    return () => controller.abort()
  }, [orgId, tag.id])

  const close = () => {
    running.current?.abort()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{tag.name}</DialogDescription>
        </DialogHeader>
        <div data-testid="tag-recalc-state" aria-live="polite" className="text-sm text-ink">
          {phase.kind === 'running' && <p>{t('running', { scanned: phase.scanned })}</p>}
          {phase.kind === 'done' && <p className="font-medium">{t('done', { scanned: phase.scanned })}</p>}
          {phase.kind === 'failed' && <p className="text-expense">{t('failed')}</p>}
        </div>
        <DialogFooter>
          <Button data-testid="tag-recalc-close" type="button" variant="outline" onClick={close}>
            {phase.kind === 'running' ? tCommon('cancel') : tCommon('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
