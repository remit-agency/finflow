import { describe, expect, it } from 'vitest'
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { addDays } from '@/lib/domain/ledger/days'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { diffRollups, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { ACCOUNTS, BASE, Model, TODAY, fakeEvidence, randomTx, rng } from './model'

const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const KEY = (n: number) => n.toString(16).padStart(32, '0')

/** What the ledger does before it stores an operation in another currency: the rates (the model's deterministic fake). */
function withRates(tx: LedgerTransaction): LedgerTransaction {
  const plan = fxPlan(tx, BASE, TODAY)
  return attachFx(tx, plan, plan.map((p) => fakeEvidence(p.from, p.to, p.date)))
}

/** A bank operation as the import writes it: actual, no category, the accrual on the payment day, a bank block. */
function bankOp(n: number, type: 'income' | 'expense', account: LedgerAccount, paymentDate: string, amountMinor: number): LedgerTransaction {
  const input = parseTransactionInput({ type, accountId: account.id, amountMinor, paymentDate })
  const built = buildTransaction(`bk_${KEY(n)}`, input, { today: TODAY, account, category: null, baseCurrency: BASE })
  return { ...withRates(built), bank: { accountRef: `ba-${account.id}` } }
}

/** A bank expense of one account and the bank income of another that a merge accepts. */
function bankPair(r: () => number, n: number): [LedgerTransaction, LedgerTransaction] {
  const from = pick(r, ACCOUNTS)
  const to = pick(r, ACCOUNTS.filter((a) => a.id !== from.id))
  const day = addDays(TODAY, -int(r, 3, 60))
  const amount = int(r, 1, 300_000)
  const out = bankOp(n, 'expense', from, day, amount)
  const inc = bankOp(n + 1, 'income', to, addDays(day, int(r, -3, 3)), from.currency === to.currency ? amount : int(r, 1, 300_000))
  return [out, inc]
}

function checkAgainstOracle(model: Model): void {
  const oracle = computeLedger(ACCOUNTS, [...model.txs.values()], BASE)
  expect(oracle.invalid).toEqual([])
  expect(model.balances).toEqual(oracle.balances)
  expect(diffRollups(model.rollups, oracle.rollups)).toEqual([])
}

const copyRollups = (docs: RollupDocs): RollupDocs => new Map([...docs].map(([id, flat]) => [id, { ...flat }]))

/** Background noise: random operations of the S05 generator (planned ones, transfers, other currencies). */
function noise(r: () => number, model: Model, count: number, prefix: string): void {
  for (let i = 0; i < count; i++) {
    const tx = randomTx(r, `${prefix}${i}`)
    if (tx) model.commit(null, tx)
  }
}

describe('own transfers (S10b) over random ledgers', () => {
  it('merges keep every balance, splits give back the balances and rollups of the bank operations, and the oracle agrees throughout', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(20_000 + seed)
      const model = new Model()
      noise(r, model, 15, 'n')
      const pairs = Array.from({ length: 4 }, (_, i) => bankPair(r, 100 * seed + 10 * i))
      for (const [out, inc] of pairs) {
        model.commit(null, out)
        model.commit(null, inc)
      }
      const balances = { ...model.balances }
      const rollups = copyRollups(model.rollups)

      const transfers = pairs.map(([out, inc]) => {
        const { transfer } = mergeToTransfer(out, inc)
        model.commit(out, transfer)
        model.commit(inc, null)
        checkAgainstOracle(model)
        expect(model.balances).toEqual(balances)
        return transfer
      })

      for (const transfer of transfers) {
        const { kept, recreated } = splitTransferSides(transfer)
        model.commit(transfer, withRates(kept))
        if (recreated) model.commit(null, withRates(recreated))
        checkAgainstOracle(model)
      }
      expect(model.balances).toEqual(balances)
      expect(diffRollups(model.rollups, rollups)).toEqual([])
    }
  })

  it('a conversion keeps the bank account balance, moves the target by the amount, and a split gives everything back', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(30_000 + seed)
      const model = new Model()
      noise(r, model, 10, 'n')
      // pln1 is the bank, pln2 the cash box: one currency, as a conversion requires.
      const [bank, cash] = [ACCOUNTS[0], ACCOUNTS[1]]
      const type = r() < 0.5 ? 'income' : 'expense'
      const op = bankOp(seed, type, bank, addDays(TODAY, -int(r, 0, 60)), int(r, 1, 300_000))
      model.commit(null, op)
      const balances = { ...model.balances }
      const rollups = copyRollups(model.rollups)

      const transfer = convertToTransfer(op, cash)
      model.commit(op, transfer)
      checkAgainstOracle(model)
      expect(model.balances[bank.id]).toBe(balances[bank.id])
      expect(model.balances[cash.id]).toBe(balances[cash.id] + (type === 'expense' ? op.amountMinor : -op.amountMinor))

      const { kept, recreated } = splitTransferSides(transfer)
      expect(recreated).toBeNull()
      model.commit(transfer, withRates(kept))
      checkAgainstOracle(model)
      expect(model.balances).toEqual(balances)
      expect(diffRollups(model.rollups, rollups)).toEqual([])
    }
  })
})
