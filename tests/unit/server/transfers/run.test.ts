import { afterEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import type { MadeTransfer, TransferJob } from '@/lib/server/ledger/transfer'
import { runTransfers } from '@/lib/server/transfers/run'

const tx = (id: string) => ({ id }) as LedgerTransaction
const made = (id: string, deletedId: string | null): MadeTransfer => ({ transaction: tx(id), deletedId, droppedTags: 1, before: [tx(id)] })

afterEach(() => vi.restoreAllMocks())

describe('runTransfers', () => {
  it('runs every suggested pair with its versions as timestamps, one by one, and answers a result for each', async () => {
    const jobs: TransferJob[] = []
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        jobs.push(job)
        if (job.mode === 'pair' && job.ids[0] === 'a2') throw new LedgerError('conflict')
        return made(job.mode === 'pair' ? job.ids[0] : job.id, job.mode === 'pair' ? job.ids[1] : null)
      }),
    }
    const out = await runTransfers(ledger, 'org1', 'u1', {
      kind: 'pairs',
      pairs: [
        { ids: ['a1', 'b1'], versions: ['1790000000.000000001', '1790000000.000000002'] },
        { ids: ['a2', 'b2'], versions: ['1790000001.000000000', '1790000001.000000000'] },
      ],
    })
    expect(out).toEqual([
      { ids: ['a1', 'b1'], ok: true, id: 'a1', deletedId: 'b1', droppedTags: 1, before: [tx('a1')] },
      { ids: ['a2', 'b2'], ok: false, code: 'conflict' },
    ])
    expect(jobs[0]).toEqual({ mode: 'pair', ids: ['a1', 'b1'], versions: [new Timestamp(1790000000, 1), new Timestamp(1790000000, 2)] })
    expect(ledger.makeTransfer).toHaveBeenCalledTimes(2)
  })

  it('a merge is one pair without versions; a conversion is one job per operation', async () => {
    const jobs: TransferJob[] = []
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        jobs.push(job)
        return made(job.mode === 'convert' ? job.id : job.ids[0], null)
      }),
    }
    await runTransfers(ledger, 'org1', 'u1', { kind: 'merge', ids: ['x', 'y'] })
    await runTransfers(ledger, 'org1', 'u1', { kind: 'convert', ids: ['c1', 'c2'], toAccountId: 'cash' })
    expect(jobs).toEqual([
      { mode: 'pair', ids: ['x', 'y'] },
      { mode: 'convert', id: 'c1', toAccountId: 'cash' },
      { mode: 'convert', id: 'c2', toAccountId: 'cash' },
    ])
  })

  it('an unexpected error is that result `unknown`, logged once, and the rest go on', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        if (job.mode === 'convert' && job.id === 'c1') throw new Error('socket hang up')
        return made(job.mode === 'convert' ? job.id : 'x', null)
      }),
    }
    const out = await runTransfers(ledger, 'org1', 'u1', { kind: 'convert', ids: ['c1', 'c2'], toAccountId: 'cash' })
    expect(out.map((o) => (o.ok ? 'ok' : o.code))).toEqual(['unknown', 'ok'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls[0])).toContain('c1')
  })
})
