import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => {
  const toast = vi.fn() as ReturnType<typeof vi.fn> & { error: ReturnType<typeof vi.fn> }
  toast.error = vi.fn()
  return toast
})
vi.mock('sonner', () => ({ toast: toastMock }))

import { UNDO_MS, undoToast } from '@/lib/ui/undo-toast'

beforeEach(() => {
  toastMock.mockReset()
  toastMock.error.mockReset()
})

type Options = { duration: number; action: { label: string; onClick: () => void } }
const shown = (): Options => toastMock.mock.calls[0][1] as Options
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('undoToast', () => {
  it('shows the message for about ten seconds with the action label', () => {
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo: async () => undefined })
    expect(toastMock.mock.calls[0][0]).toBe('Deleted')
    expect(shown().duration).toBe(UNDO_MS)
    expect(shown().action.label).toBe('Undo')
  })

  it('uses the given duration instead of the default', () => {
    undoToast({ message: 'm', actionLabel: 'a', failureMessage: 'f', undo: async () => undefined, duration: 15_000 })
    expect(shown().duration).toBe(15_000)
  })

  it('forwards the id so a newer toast for the same operation replaces the older one', () => {
    undoToast({ message: 'Saved', actionLabel: 'Undo', failureMessage: 'Failed', id: 'undo-tx1', undo: async () => undefined })
    expect(toastMock.mock.calls[0][1]).toMatchObject({ id: 'undo-tx1' })
  })

  it('runs the undo on click and stays quiet when it works', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo })
    shown().action.onClick()
    await flush()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('tells the person when the undo is refused', async () => {
    undoToast({ message: 'Deleted', actionLabel: 'Undo', failureMessage: 'Failed', undo: () => Promise.reject(new Error('409')) })
    shown().action.onClick()
    await flush()
    expect(toastMock.error).toHaveBeenCalledWith('Failed')
  })
})
