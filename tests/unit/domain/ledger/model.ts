import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { changeSet } from '@/lib/domain/ledger/change'
import { addDays } from '@/lib/domain/ledger/days'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { addInto, type RollupDocs } from '@/lib/domain/ledger/rollups'
import type { LedgerAccount, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'

export const TODAY = '2026-10-27'
export const BASE = 'PLN'

export const ACCOUNTS: LedgerAccount[] = [
  { id: 'pln1', name: 'pln1', type: 'bank', currency: 'PLN', color: '#000000', openingMinor: 100000, balanceMinor: 100000 },
  { id: 'pln2', name: 'pln2', type: 'cash', currency: 'PLN', color: '#000000', openingMinor: 0, balanceMinor: 0 },
  { id: 'eur1', name: 'eur1', type: 'bank', currency: 'EUR', color: '#000000', openingMinor: 50000, balanceMinor: 50000 },
]

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

/** A deterministic fake NBP rate: depends on the currency and the date only. */
export function fakeEvidence(from: string, to: string, date: string): RateEvidence {
  const n = Number(date.replaceAll('-', '')) % 97
  const rate = from === 'EUR' && to === 'PLN' ? 4.2 + n / 100 : 1
  return { rate, from, to, requestedDate: date, rateDate: addDays(date, -1), tableNo: `${n}/A/NBP/2026`, source: 'NBP_A' }
}

/** A random valid operation with id `id`, or null when the random draw is not valid. */
export function randomTx(r: () => number, id: string): LedgerTransaction | null {
  const type = pick(r, ['income', 'expense', 'expense', 'income', 'transfer'] as const)
  const account = pick(r, ACCOUNTS)
  const planned = r() < 0.15
  const payment = addDays(TODAY, planned ? int(r, 1, 60) : -int(r, 0, 120))
  const input: Record<string, unknown> = {
    type,
    status: planned ? 'planned' : 'actual',
    accountId: account.id,
    amountMinor: int(r, 1, 500000),
    paymentDate: payment,
  }
  let toAccount
  if (type === 'transfer') {
    toAccount = pick(r, ACCOUNTS.filter((a) => a.id !== account.id))
    input.toAccountId = toAccount.id
    if (toAccount.currency !== account.currency) input.toAmountMinor = int(r, 1, 200000)
  } else {
    if (r() < 0.7) input.categoryId = pick(r, type === 'income' ? ['ci1', 'ci2'] : ['ce1', 'ce2'])
    const kind = r()
    if (kind < 0.25) input.accrual = { mode: 'date', date: addDays(payment, -int(r, 1, 90)) }
    else if (kind < 0.5) {
      const from = addDays(payment, -int(r, 0, 60))
      input.accrual = { mode: 'period', from, to: addDays(from, int(r, 0, 400)) }
    }
  }
  try {
    const built = buildTransaction(id, parseTransactionInput(input), {
      today: TODAY,
      account,
      toAccount,
      category: input.categoryId ? { type: type as 'income' | 'expense' } : null,
      baseCurrency: BASE,
    })
    const plan = fxPlan(built, BASE, TODAY)
    const tx = attachFx(built, plan, plan.map((p) => fakeEvidence(p.from, p.to, p.date)))
    // S10t: about one operation in four is excluded from analytics. The ledger computes the flag from the tags; the
    // model takes it as given, so an update may switch it.
    return r() < 0.25 ? { ...tx, excluded: true } : tx
  } catch (e) {
    if (e instanceof LedgerError) return null
    throw e
  }
}

/** The state the server maintains incrementally; `commit` mirrors one write transaction. */
export class Model {
  readonly txs = new Map<string, LedgerTransaction>()
  readonly balances: Record<string, number> = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.openingMinor]))
  readonly rollups: RollupDocs = new Map()

  commit(prior: LedgerTransaction | null, next: LedgerTransaction | null): void {
    const change = changeSet(prior, next, BASE)
    for (const [id, delta] of Object.entries(change.balanceDeltas)) this.balances[id] += delta
    addInto(this.rollups, change.rollupDeltas)
    if (next) this.txs.set(next.id, next)
    else if (prior) this.txs.delete(prior.id)
  }
}
