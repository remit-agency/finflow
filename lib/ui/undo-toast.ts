import { toast } from 'sonner'

export const UNDO_MS = 10_000

export interface UndoToast {
  message: string
  actionLabel: string
  failureMessage: string
  /** Reverses what the toast announces. It runs after the form that raised it is gone, so it must not touch component state. */
  undo: () => Promise<unknown>
}

export function undoToast({ message, actionLabel, failureMessage, undo }: UndoToast): void {
  toast(message, {
    duration: UNDO_MS,
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
