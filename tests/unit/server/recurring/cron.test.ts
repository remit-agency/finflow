import { describe, expect, it, vi } from 'vitest'
import { runRecurringCron } from '@/lib/server/recurring/cron'

describe('runRecurringCron (S11)', () => {
  it('never throws: when the ledger dependencies cannot be made, that is one failure in the counts (MINOR a)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const summary = await runRecurringCron(
      () => {
        throw new Error('the project id is missing')
      },
      { budgetMs: 10_000 },
    )
    expect(summary).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 1 })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('does not build the dependencies at all without time left', async () => {
    const deps = vi.fn()
    expect(await runRecurringCron(deps, { budgetMs: 0 })).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 })
    expect(deps).not.toHaveBeenCalled()
  })
})
