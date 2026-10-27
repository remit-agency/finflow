import { describe, expect, it } from 'vitest'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { simulateRollups } from '@/scripts/lib/simulate-ledger-v2'

const account: LedgerAccount = { id: 'a', name: 'a', type: 'bank', currency: 'PLN', color: '#000000', openingMinor: 0, balanceMinor: 0 }
const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 't', type: 'income', status: 'actual', accountId: 'a', amountMinor: 1000, currency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], ...over,
})
const run = (txs: LedgerTransaction[]) => simulateRollups({ baseCurrency: 'PLN', accounts: [account], txs })

describe('simulateRollups', () => {
  it('returns null when the rollups can be built and written', () => {
    expect(run([tx({ categoryId: 'c1' }), tx({ id: 'u', type: 'expense' }), tx({ id: 'k', categoryId: 'constructor' })])).toBeNull()
    expect(run([])).toBeNull()
  })

  it.each([
    ['an empty category id', { categoryId: '' }],
    ['a reserved category id', { categoryId: '__proto__' }],
    ['a category id with a dot', { categoryId: 'a.b' }],
  ])('names the operation when %s would produce an unwritable rollup document', (_label, over) => {
    const message = run([tx({ id: 'fine1' }), tx({ id: 'bad', ...over })])
    expect(message).toContain('bad')
    expect(message).not.toContain('fine1')
  })

  it('an operation that cannot be counted (unknown account, no base amounts) is left out by the rebuild and is not a failure', () => {
    expect(run([tx({ id: 'x', accountId: 'ghost' })])).toBeNull()
    expect(run([tx({ id: 'y', currency: 'EUR' })])).toBeNull()
  })

  it('reports an exception thrown while building the rollups', () => {
    // A fractional amount over a period makes the allocation throw (BigInt of a non-integer).
    const broken = tx({ id: 'z', amountMinor: 1.5, accrual: { mode: 'period', from: '2026-10-01', to: '2026-11-30' } })
    expect(run([broken])).toContain('z')
  })
})
