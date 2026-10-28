import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify() }))

import { linkBankAccount, syncBankAccount } from '@/lib/api/bank-client'

function step(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('syncBankAccount', () => {
  it('calls the step endpoint until done, adds the totals and tells the journal once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(step({ imported: 25, skipped: 0, failed: 0, done: false, bankBalanceMinor: null, differenceMinor: null }))
      .mockResolvedValueOnce(step({ imported: 5, skipped: 2, failed: 1, done: true, bankBalanceMinor: 100, differenceMinor: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []
    const totals = await syncBankAccount('org1', 'ba1', { onProgress: (t) => progress.push(t.imported) })
    expect(totals).toEqual({ imported: 30, skipped: 2, failed: 1, bankBalanceMinor: 100, differenceMinor: 0, busy: false })
    expect(progress).toEqual([25])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org1/bank/sync')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ bankAccountId: 'ba1' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not touch the journal when nothing was imported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(step({ imported: 0, skipped: 3, failed: 0, done: true, bankBalanceMinor: 1, differenceMinor: 0 })))
    await syncBankAccount('org1', 'ba1')
    expect(notify).not.toHaveBeenCalled()
  })

  it('another tab holding the lock ends quietly as busy; any other failure throws with its code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(step({ error: 'already_running' }, 409)))
    expect(await syncBankAccount('org1', 'ba1')).toMatchObject({ busy: true, imported: 0 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(step({ error: 'consent_expired' }, 409)))
    await expect(syncBankAccount('org1', 'ba1')).rejects.toMatchObject({ code: 'consent_expired', status: 409 })
  })
})

describe('linkBankAccount', () => {
  it('does not announce the change before its first sync: the sync that follows does, so the auto-sync cannot race it', async () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const announced = vi.fn()
    target.addEventListener('finflow:bank-changed', announced)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(step({ bankAccountId: 'ba1', accountId: 'a1' }, 201)))
    await linkBankAccount('org1', { connectionId: 'c1', ebAccountUid: 'u1', mode: 'create', name: 'Konto', importFrom: '2026-01-01' })
    expect(announced).not.toHaveBeenCalled()
  })
})
