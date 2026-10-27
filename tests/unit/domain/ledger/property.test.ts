import { describe, expect, it } from 'vitest'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { diffRollups } from '@/lib/domain/ledger/rollups'
import { ACCOUNTS, BASE, Model, randomTx, rng } from './model'

function checkAgainstOracle(model: Model): void {
  const oracle = computeLedger(ACCOUNTS, [...model.txs.values()], BASE)
  expect(oracle.invalid).toEqual([])
  expect(model.balances).toEqual(oracle.balances)
  expect(diffRollups(model.rollups, oracle.rollups)).toEqual([])
}

describe('ledger algebra (random create / update / delete sequences)', () => {
  it('incremental balances and rollups always equal the from-scratch computation', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed)
      const model = new Model()
      let nextId = 0
      for (let step = 0; step < 40; step++) {
        const ids = [...model.txs.keys()]
        const roll = r()
        if (roll < 0.6 || ids.length === 0) {
          const tx = randomTx(r, `t${nextId++}`)
          if (tx) model.commit(null, tx)
        } else if (roll < 0.85) {
          const id = ids[Math.floor(r() * ids.length)]
          const tx = randomTx(r, id)
          if (tx) model.commit(model.txs.get(id) ?? null, tx)
        } else {
          const id = ids[Math.floor(r() * ids.length)]
          model.commit(model.txs.get(id) ?? null, null)
        }
        checkAgainstOracle(model)
      }
    }
  })

  it('deleting everything returns balances to the opening values and leaves no rollups', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(1000 + seed)
      const model = new Model()
      for (let i = 0; i < 25; i++) {
        const tx = randomTx(r, `t${i}`)
        if (tx) model.commit(null, tx)
      }
      for (const tx of [...model.txs.values()]) model.commit(tx, null)
      expect(model.balances).toEqual(Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.openingMinor])))
      expect(model.rollups.size).toBe(0)
    }
  })

  it('an update equals a delete followed by a create', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(5000 + seed)
      const first = randomTx(r, 't')
      const second = randomTx(r, 't')
      if (!first || !second) continue
      const direct = new Model()
      direct.commit(null, first)
      direct.commit(first, second)
      const stepwise = new Model()
      stepwise.commit(null, first)
      stepwise.commit(first, null)
      stepwise.commit(null, second)
      expect(direct.balances).toEqual(stepwise.balances)
      expect(diffRollups(direct.rollups, stepwise.rollups)).toEqual([])
    }
  })

  it('the generator produces enough valid operations to be meaningful', () => {
    const r = rng(42)
    let valid = 0
    for (let i = 0; i < 200; i++) if (randomTx(r, `t${i}`)) valid++
    expect(valid).toBeGreaterThan(120)
  })
})
