'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { applyToExisting, checkExisting, type ApplyTotals, type CheckTotals } from '@/lib/api/rules-client'

interface Props {
  orgId: string
  onClose: () => void
}

type Phase =
  | { kind: 'checking'; scanned: number }
  | { kind: 'ready'; totals: CheckTotals }
  | { kind: 'applying'; changed: number }
  | { kind: 'done'; totals: ApplyTotals }
  | { kind: 'failed' }

/**
 * «Застосувати до наявних»: counts first («буде змінено N»), applies after the confirmation with the progress, then the
 * summary. Mounted only while open, so every opening counts afresh.
 */
export function ApplyRulesDialog({ orgId, onClose }: Props) {
  const t = useTranslations('settings.rules.apply')
  const tCommon = useTranslations('common')
  const [phase, setPhase] = useState<Phase>({ kind: 'checking', scanned: 0 })
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    running.current = controller
    checkExisting(orgId, { signal: controller.signal, onProgress: (p) => setPhase({ kind: 'checking', scanned: p.scanned }) }).then(
      (totals) => setPhase({ kind: 'ready', totals }),
      () => {
        if (!controller.signal.aborted) setPhase({ kind: 'failed' })
      },
    )
    return () => controller.abort()
  }, [orgId])

  const apply = async () => {
    const controller = new AbortController()
    running.current = controller
    setPhase({ kind: 'applying', changed: 0 })
    try {
      const totals = await applyToExisting(orgId, { signal: controller.signal, onProgress: (p) => setPhase({ kind: 'applying', changed: p.changed }) })
      setPhase({ kind: 'done', totals })
    } catch {
      if (!controller.signal.aborted) setPhase({ kind: 'failed' })
    }
  }

  /** Closing stops the next step; a step already sent finishes on the server (it is safe to repeat). */
  const close = () => {
    running.current?.abort()
    onClose()
  }

  const finished = phase.kind === 'done' || phase.kind === 'failed'

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug">{t('title')}</DialogTitle>
          <DialogDescription>{t('note')}</DialogDescription>
        </DialogHeader>
        <div data-testid="rules-apply-state" className="space-y-1 text-sm text-ink" aria-live="polite">
          {phase.kind === 'checking' && <p>{t('checking', { scanned: phase.scanned })}</p>}
          {phase.kind === 'ready' &&
            (phase.totals.matchOps === 0 ? (
              <p>{t('nothing')}</p>
            ) : (
              <>
                <p className="font-medium">{t('willChange', { count: phase.totals.matchOps })}</p>
                <p className="text-ink-muted">{t('breakdown', { categories: phase.totals.categories, counterparties: phase.totals.counterparties })}</p>
              </>
            ))}
          {phase.kind === 'applying' && <p>{t('running', { changed: phase.changed })}</p>}
          {phase.kind === 'done' && (
            <>
              <p className="font-medium">{t('done', { changed: phase.totals.changed })}</p>
              {phase.totals.failed > 0 && <p className="text-expense">{t('failed', { failed: phase.totals.failed })}</p>}
            </>
          )}
          {phase.kind === 'failed' && <p className="text-expense">{t('error')}</p>}
        </div>
        <DialogFooter>
          <Button data-testid="rules-apply-close" variant="outline" onClick={close}>
            {finished ? tCommon('close') : tCommon('cancel')}
          </Button>
          {phase.kind === 'ready' && phase.totals.matchOps > 0 && (
            <Button data-testid="rules-apply-confirm" onClick={() => void apply()}>
              {t('confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
