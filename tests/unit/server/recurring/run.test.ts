import { describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { runMatches, type MatchLedger } from '@/lib/server/recurring/run'

const BANK = `bk_${'a'.repeat(32)}`
const tx = (id: string) => ({ id }) as LedgerTransaction

function fakeLedger() {
  return {
    confirmMatch: vi.fn(async (_o: string, _u: string, job: { planId: string; bankId: string }) => {
      if (job.planId.endsWith('15')) throw new LedgerError('conflict')
      if (job.planId.endsWith('16')) throw new Error('boom')
      return { bank: tx(job.bankId), plan: tx(job.planId) }
    }),
    undoMatch: vi.fn(async (_o: string, _u: string, planId: string) => ({ bank: tx(BANK), plan: tx(planId) })),
  } satisfies MatchLedger
}

describe('runMatches', () => {
  it('runs each pair on its own with the versions as timestamps; a refusal or an error is the result of that pair', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ledger = fakeLedger()
    const V = '1790000000.000000001'
    const out = await runMatches(ledger, 'org1', 'u1', {
      kind: 'confirm',
      items: [
        { planId: 'pl_a_2026-11-14', bankId: BANK, versions: [V, V] },
        { planId: 'pl_a_2026-11-15', bankId: `bk_${'b'.repeat(32)}`, versions: [V, V] },
        { planId: 'pl_a_2026-11-16', bankId: `bk_${'c'.repeat(32)}`, versions: [V, V] },
      ],
    })
    expect(out).toEqual([
      { planId: 'pl_a_2026-11-14', ok: true, bankId: BANK },
      { planId: 'pl_a_2026-11-15', ok: false, code: 'conflict' },
      { planId: 'pl_a_2026-11-16', ok: false, code: 'unknown' },
    ])
    expect(ledger.confirmMatch.mock.calls[0][2]).toEqual({ planId: 'pl_a_2026-11-14', bankId: BANK, versions: [new Timestamp(1790000000, 1), new Timestamp(1790000000, 1)] })
  })

  it('undoes by plan id', async () => {
    const ledger = fakeLedger()
    expect(await runMatches(ledger, 'org1', 'u1', { kind: 'undo', planIds: ['pl_a_2026-11-14'] })).toEqual([{ planId: 'pl_a_2026-11-14', ok: true, bankId: BANK }])
    expect(ledger.undoMatch).toHaveBeenCalledWith('org1', 'u1', 'pl_a_2026-11-14')
  })
})
