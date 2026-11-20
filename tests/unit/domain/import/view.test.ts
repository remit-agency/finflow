import { describe, expect, it } from 'vitest'
import { canUndo } from '@/lib/domain/import/view'

describe('canUndo', () => {
  it('an applied import can be undone', () => {
    expect(canUndo('applied')).toBe(true)
  })

  it('an import whose undo stopped part way (undoing) can be undone again: the undo resumes from its start', () => {
    expect(canUndo('undoing')).toBe(true)
  })

  it('an undone import cannot be undone again', () => {
    expect(canUndo('undone')).toBe(false)
  })
})
