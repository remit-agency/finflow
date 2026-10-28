'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
  busy?: boolean
  /** Shown under the question while `busy` (e.g. «Видалено 40 з 120»). */
  progress?: string | null
  /** With `onStop`, the cancel button reads this and stops the running work while `busy`, instead of being disabled. */
  stopLabel?: string
  onStop?: () => void
  onConfirm: () => void
  onCancel: () => void
}

/** A yes/no question over the form: closing it (Esc, the cross) answers «no». */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, destructive, busy, progress, stopLabel, onStop, onConfirm, onCancel }: Props) {
  const stoppable = !!busy && !!onStop && !!stopLabel
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {busy && progress && (
          <p role="status" className="text-sm text-ink-muted tabular-nums">
            {progress}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={stoppable ? onStop : onCancel} disabled={busy && !stoppable}>
            {stoppable ? stopLabel : cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
