import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncStep } from '@/lib/server/banking/sync'
import { loadUsableRules } from '@/lib/server/rules/read'
import { ORG, UID, clearFirestore, seedAccount, seedCategory, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'

// The rules read of a sync step is replaced by a wrapper that the test can make fail once (the real read otherwise).
vi.mock('@/lib/server/rules/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/rules/read')>()
  return { ...real, loadUsableRules: vi.fn(real.loadUsableRules) }
})

const db = testDb()
const txCol = () => db.collection(`organizations/${ORG}/transactions`)

const PAGE = {
  '': {
    transactions: [
      ebTx('u1', '50.00', 'DBIT', '2026-10-25', { creditor: { name: 'ORLEN STACJA 123' }, remittance_information: ['Płatność kartą'] }),
      ebTx('u2', '20.00', 'DBIT', '2026-10-26', { creditor: { name: 'Kawiarnia' }, remittance_information: ['Kawa'] }),
    ],
    continuationKey: null,
  },
}

beforeEach(async () => {
  vi.mocked(loadUsableRules).mockClear()
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
})

describe('a sync step whose rules cannot be read', () => {
  it('logs the failure without the document data and imports every operation without rules', async () => {
    vi.mocked(loadUsableRules).mockRejectedValueOnce(Object.assign(new Error('PERMISSION of rules/secret-doc-id'), { code: 7 }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await seedBank(db)
      const deps = bankDeps(db, fakeEb(PAGE))
      let done = false
      for (let i = 0; i < 10 && !done; i++) done = (await syncStep(deps, ORG, UID, 'ba1')).done
      expect(done).toBe(true)
      expect((await txCol().get()).size).toBe(2)
      expect(log).toHaveBeenCalledWith('bank sync: rules could not be read', { orgId: ORG, code: 7 })
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-doc-id')
    } finally {
      log.mockRestore()
    }
  })
})
