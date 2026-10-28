import { toast } from 'sonner'

export const UNDO_MS = 10_000

export interface UndoToast {
  message: string
  actionLabel: string
  failureMessage: string
  /** A newer toast with the same id replaces the older one, so a stale «undo» cannot overwrite a later change. */
  id?: string
  /** How long the toast stays, ms; default `UNDO_MS`. */
  duration?: number
  /** Reverses what the toast announces. It runs after the form that raised it is gone, so it must not touch component state. */
  undo: () => Promise<unknown>
}

export function undoToast({ message, actionLabel, failureMessage, id, duration, undo }: UndoToast): void {
  toast(message, {
    id,
    duration: duration ?? UNDO_MS,
    action: {
      label: actionLabel,
      onClick: () => {
        void undo().catch(() => {
          toast.error(failureMessage)
        })
      },
    },
  })
}
