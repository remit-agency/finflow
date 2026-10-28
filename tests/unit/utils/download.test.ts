// tests/unit/utils/download.test.ts
import { describe, expect, it } from 'vitest'
import { exportFileName } from '@/lib/utils/download'

describe('exportFileName', () => {
  it('journal-YYYY-MM-DD.csv', () => {
    expect(exportFileName('journal', '2026-10-28')).toBe('journal-2026-10-28.csv')
  })
})
