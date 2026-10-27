import { describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { planOrg, type LegacyDoc, type PlanInput } from '@/scripts/lib/plan-ledger-v2'

const DAY = new Date('2026-10-20T00:00:00Z')

function acc(id: string, balance: unknown, currency: unknown = 'PLN', over: Record<string, unknown> = {}): LegacyDoc {
  return { id, data: { name: id, type: 'bank', currency, balance, color: '#112233', ...over } }
}

function legacyTx(id: string, over: Record<string, unknown> = {}): LegacyDoc {
  return { id, data: { type: 'income', accountId: 'a', amount: 10, date: DAY, ...over } }
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    baseCurrency: 'PLN',
    today: '2026-10-27',
    legacyAccounts: [],
    migratedAccounts: new Map(),
    legacyTxs: [],
    markedTxs: [],
    resetOpening: new Set(),
    ...over,
  }
}

const screenshot = (over: Partial<PlanInput> = {}) =>
  input({
    legacyAccounts: [acc('a', 1234.5)],
    legacyTxs: [
      legacyTx('i1', { amount: 1234.6 }),
      legacyTx('i2', { amount: 10 }),
      legacyTx('x1', { type: 'expense', amount: 10 }),
    ],
    ...over,
  })

describe('planOrg: opening balance', () => {
  it('the screenshot case: the opening balance absorbs the drift between the stored balance and the operations', () => {
    const plan = planOrg(screenshot())
    expect(plan.accounts).toHaveLength(1)
    expect(plan.accounts[0]).toMatchObject({ id: 'a', sumMinor: 123460, legacyBalanceMinor: 123450, openingMinor: -10, balanceMinor: 123450 })
    expect(plan.accounts[0].fields).toMatchObject({ openingMinor: -10, balanceMinor: 123450, schemaVersion: 2, currency: 'PLN' })
    expect(plan.txs.map((t) => t.id)).toEqual(['i1', 'i2', 'x1'])
    expect(plan.txs[0].tx).toMatchObject({ status: 'actual', amountMinor: 123460, paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' } })
  })

  it('resetOpening opens the account at 0 and the balance becomes the sum', () => {
    const plan = planOrg(screenshot({ resetOpening: new Set(['a']) }))
    expect(plan.accounts[0]).toMatchObject({ openingMinor: 0, balanceMinor: 123460, legacyBalanceMinor: 123450, sumMinor: 123460 })
  })

  it('operations a previous run migrated count toward a legacy account', () => {
    const marked: LedgerTransaction = {
      id: 'm1', type: 'income', status: 'actual', accountId: 'a', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-01', accrual: { mode: 'date', date: '2026-10-01' }, isRecurring: false, tags: [], fileUrls: [],
    }
    const plan = planOrg(input({ legacyAccounts: [acc('a', 100)], markedTxs: [marked] }))
    expect(plan.accounts[0]).toMatchObject({ sumMinor: 500, openingMinor: 9500, balanceMinor: 10000 })
  })

  it('an account without operations opens at its stored balance', () => {
    const plan = planOrg(input({ legacyAccounts: [acc('a', 12.34)] }))
    expect(plan.accounts[0]).toMatchObject({ sumMinor: 0, openingMinor: 1234, balanceMinor: 1234 })
  })

  it('applies defaults for an unknown type and a bad color', () => {
    const plan = planOrg(input({ legacyAccounts: [acc('a', 1, 'PLN', { type: 'wallet', color: 'red' })] }))
    expect(plan.accounts[0].fields).toMatchObject({ type: 'bank', color: '#00c896' })
  })
})

describe('planOrg: transfers', () => {
  const two = (tx: Record<string, unknown>) =>
    planOrg(input({ legacyAccounts: [acc('a', 100), acc('b', 50)], legacyTxs: [legacyTx('t', { type: 'transfer', amount: 5, ...tx })] }))

  it('counterpartyId becomes toAccountId with the same amount', () => {
    const plan = two({ counterpartyId: 'b' })
    expect(plan.txs[0].tx).toMatchObject({ type: 'transfer', accountId: 'a', toAccountId: 'b', toAmountMinor: 500, toCurrency: 'PLN', amountMinor: 500 })
    expect(plan.counters.transferAmountAssumed).toBe(0)
    const byId = Object.fromEntries(plan.accounts.map((x) => [x.id, x]))
    expect(byId.a.sumMinor).toBe(-500)
    expect(byId.b.sumMinor).toBe(500)
  })

  it('counts a cross-currency transfer whose target amount had to be assumed', () => {
    const plan = planOrg(
      input({ legacyAccounts: [acc('a', 100), acc('e', 50, 'EUR')], legacyTxs: [legacyTx('t', { type: 'transfer', amount: 5, counterpartyId: 'e' })] }),
    )
    expect(plan.txs[0].tx).toMatchObject({ toCurrency: 'EUR', toAmountMinor: 500 })
    expect(plan.counters.transferAmountAssumed).toBe(1)
  })

  it('a transfer to an unknown account is skipped unknown_target, to itself same_account, without a target unknown_target', () => {
    expect(two({ counterpartyId: 'zzz' }).skipped).toEqual([{ kind: 'tx', id: 't', reason: 'unknown_target' }])
    expect(two({ counterpartyId: 'a' }).skipped).toEqual([{ kind: 'tx', id: 't', reason: 'same_account' }])
    expect(two({}).skipped).toEqual([{ kind: 'tx', id: 't', reason: 'unknown_target' }])
    expect(two({ counterpartyId: 'zzz' }).txs).toEqual([])
  })

  it('a transfer to an already migrated account is planned', () => {
    const plan = planOrg(
      input({
        legacyAccounts: [acc('a', 100)],
        migratedAccounts: new Map([['b', 'PLN']]),
        legacyTxs: [legacyTx('t', { type: 'transfer', amount: 5, counterpartyId: 'b' })],
      }),
    )
    expect(plan.txs[0].tx.toAccountId).toBe('b')
  })
})

describe('planOrg: currencies and rates', () => {
  it('a currency that differs from the account is kept as legacyCurrency, the account currency wins', () => {
    const plan = planOrg(input({ legacyAccounts: [acc('e', 10, 'EUR')], legacyTxs: [legacyTx('t', { accountId: 'e', amount: 3, currency: 'USD' })] }))
    expect(plan.txs[0].legacyCurrency).toBe('USD')
    expect(plan.txs[0].tx.currency).toBe('EUR')
    expect(plan.counters.currencyMismatch).toBe(1)
  })

  it('no legacyCurrency when the currencies agree or the field is absent', () => {
    const plan = planOrg(
      input({ legacyAccounts: [acc('e', 10, 'EUR')], legacyTxs: [legacyTx('t1', { accountId: 'e', currency: 'EUR' }), legacyTx('t2', { accountId: 'e' })] }),
    )
    expect(plan.txs.map((t) => t.legacyCurrency)).toEqual([undefined, undefined])
    expect(plan.counters.currencyMismatch).toBe(0)
  })

  it('an EUR operation on an EUR account with base PLN needs one rate; one in the base currency needs none', () => {
    const plan = planOrg(
      input({ legacyAccounts: [acc('e', 10, 'EUR'), acc('a', 10)], legacyTxs: [legacyTx('t1', { accountId: 'e' }), legacyTx('t2', { accountId: 'a' })] }),
    )
    expect(plan.txs[0].fxRequests).toEqual([{ keys: ['payment', 'accrual'], from: 'EUR', to: 'PLN', date: '2026-10-20' }])
    expect(plan.txs[1].fxRequests).toEqual([])
  })
})

describe('planOrg: skips', () => {
  const skipReason = (tx: Record<string, unknown>) => {
    const plan = planOrg(input({ legacyAccounts: [acc('a', 1)], legacyTxs: [legacyTx('t', tx)] }))
    expect(plan.txs).toEqual([])
    return plan.skipped.map((s) => `${s.kind}:${s.id}:${s.reason}`)
  }

  it('reports each unusable operation with its reason', () => {
    expect(skipReason({ accountId: undefined })).toEqual(['tx:t:unknown_account'])
    expect(skipReason({ accountId: 'nope' })).toEqual(['tx:t:unknown_account'])
    expect(skipReason({ amount: 0 })).toEqual(['tx:t:invalid_amount'])
    expect(skipReason({ amount: '5' })).toEqual(['tx:t:invalid_amount'])
    expect(skipReason({ amount: 0.001 })).toEqual(['tx:t:invalid_amount'])
    expect(skipReason({ date: null })).toEqual(['tx:t:invalid_date'])
    expect(skipReason({ date: new Date('x') })).toEqual(['tx:t:invalid_date'])
    expect(skipReason({ date: new Date('1999-12-31T00:00:00Z') })).toEqual(['tx:t:invalid_date'])
    expect(skipReason({ type: 'refund' })).toEqual(['tx:t:invalid_type'])
  })

  it('reports each unusable legacy account with its reason, and its operations as unknown_account', () => {
    const plan = planOrg(
      input({
        legacyAccounts: [acc('n', 1, 'PLN', { name: '  ' }), acc('c', 1, 'GBP'), acc('b', Number.NaN), acc('s', '5'), acc('ok', 1)],
        legacyTxs: [legacyTx('t', { accountId: 'c' })],
      }),
    )
    expect(plan.accounts.map((x) => x.id)).toEqual(['ok'])
    expect(plan.skipped).toEqual([
      { kind: 'account', id: 'n', reason: 'invalid_name' },
      { kind: 'account', id: 'c', reason: 'invalid_currency' },
      { kind: 'account', id: 'b', reason: 'invalid_balance' },
      { kind: 'account', id: 's', reason: 'invalid_balance' },
      { kind: 'tx', id: 't', reason: 'unknown_account' },
    ])
  })
})

describe('planOrg: the limits of the API apply to legacy values', () => {
  const one = (data: Record<string, unknown>) => {
    const plan = planOrg(input({ legacyAccounts: [acc('a', 1)], legacyTxs: [legacyTx('t', data)] }))
    return { plan, tx: plan.txs[0]?.tx as LedgerTransaction }
  }

  it.each(['categoryId', 'projectId', 'counterpartyId'] as const)('%s: a valid id is kept, an invalid one is omitted and counted', (field) => {
    for (const ok of ['constructor', 'toString', 'c-1_X']) {
      const { plan, tx } = one({ [field]: ok })
      expect(tx[field]).toBe(ok)
      expect(plan.counters.invalidReference).toBe(0)
    }
    for (const bad of ['', '__proto__', '__x__', 'a.b', 'a/b', 'a b', 'x'.repeat(129), 5, {}]) {
      const { plan, tx } = one({ [field]: bad })
      expect(tx).not.toHaveProperty(field)
      expect(plan.counters.invalidReference).toBe(1)
    }
  })

  it('an absent or null reference is not counted', () => {
    const { plan, tx } = one({ categoryId: null, projectId: undefined })
    expect(tx).not.toHaveProperty('categoryId')
    expect(tx).not.toHaveProperty('projectId')
    expect(plan.counters.invalidReference).toBe(0)
  })

  it('a transfer whose target is not a valid id is skipped unknown_target; its project is checked too', () => {
    const run = (data: Record<string, unknown>) =>
      planOrg(input({ legacyAccounts: [acc('a', 1), acc('b', 1), acc('__proto__', 1)], legacyTxs: [legacyTx('t', { type: 'transfer', ...data })] }))
    expect(run({ counterpartyId: '__proto__' }).skipped).toEqual([{ kind: 'tx', id: 't', reason: 'unknown_target' }])
    expect(run({ counterpartyId: 'a.b' }).skipped).toEqual([{ kind: 'tx', id: 't', reason: 'unknown_target' }])
    const ok = run({ counterpartyId: 'b', projectId: 'x y' })
    expect(ok.skipped).toEqual([])
    expect(ok.txs[0].tx).not.toHaveProperty('projectId')
    expect(ok.counters.invalidReference).toBe(1)
  })

  it('description is trimmed and cut to 500 characters', () => {
    expect(one({ description: '  hello  ' }).tx.description).toBe('hello')
    expect(one({ description: '   ' }).tx).not.toHaveProperty('description')
    const { plan, tx } = one({ description: ` ${'x'.repeat(600)} ` })
    expect(tx.description).toBe('x'.repeat(500))
    expect(plan.counters.trimmed).toBe(1)
    expect(one({ description: 'x'.repeat(500) }).plan.counters.trimmed).toBe(0)
  })

  it('tags keep strings of 1..50 characters, at most 20', () => {
    const { plan, tx } = one({ tags: ['ok', '', 'y'.repeat(51), 'z'.repeat(50), 7] })
    expect(tx.tags).toEqual(['ok', 'z'.repeat(50)])
    expect(plan.counters.trimmed).toBe(1)

    const many = one({ tags: Array.from({ length: 25 }, (_, i) => `t${i}`) })
    expect(many.tx.tags).toEqual(Array.from({ length: 20 }, (_, i) => `t${i}`))
    expect(many.plan.counters.trimmed).toBe(1)
  })

  it('fileUrls keep strings of 1..2048 characters, at most 10', () => {
    const long = `https://x/${'a'.repeat(2048)}`
    const { plan, tx } = one({ fileUrls: ['https://x/1', '', long, 3] })
    expect(tx.fileUrls).toEqual(['https://x/1'])
    expect(plan.counters.trimmed).toBe(1)

    const many = one({ fileUrls: Array.from({ length: 12 }, (_, i) => `https://x/${i}`) })
    expect(many.tx.fileUrls).toHaveLength(10)
    expect(many.plan.counters.trimmed).toBe(1)
  })

  it('every migrated operation passes the same validation as an API request', () => {
    const { tx } = one({ categoryId: 'constructor', projectId: 'p', counterpartyId: 'cp', description: ' d ', tags: ['t'], fileUrls: ['https://x/1'] })
    const parsed = parseTransactionInput({
      type: tx.type, accountId: tx.accountId, amountMinor: tx.amountMinor, paymentDate: tx.paymentDate, categoryId: tx.categoryId,
      projectId: tx.projectId, counterpartyId: tx.counterpartyId, description: tx.description, tags: tx.tags, fileUrls: tx.fileUrls,
    })
    expect(parsed).toMatchObject({ categoryId: 'constructor', description: 'd' })
  })
})

describe('planOrg: already migrated accounts and future dates', () => {
  it('already migrated accounts produce no PlannedAccount but their operations are planned', () => {
    const plan = planOrg(input({ migratedAccounts: new Map([['a', 'PLN']]), legacyTxs: [legacyTx('t')] }))
    expect(plan.accounts).toEqual([])
    expect(plan.txs).toHaveLength(1)
    expect(plan.txs[0].tx.currency).toBe('PLN')
  })

  it('a date after today is counted but the operation stays actual', () => {
    const plan = planOrg(input({ legacyAccounts: [acc('a', 1)], legacyTxs: [legacyTx('t', { date: new Date('2026-11-05T00:00:00Z') })] }))
    expect(plan.counters.futureActual).toBe(1)
    expect(plan.txs[0].tx.status).toBe('actual')
  })

  it('carries optional fields over and drops non-string array entries', () => {
    const plan = planOrg(
      input({
        legacyAccounts: [acc('a', 1)],
        legacyTxs: [legacyTx('t', { categoryId: 'c1', counterpartyId: 'p1', description: 'd', projectId: 'pr', isRecurring: true, tags: ['x', 3], fileUrls: ['u', null] })],
      }),
    )
    expect(plan.txs[0].tx).toMatchObject({ categoryId: 'c1', counterpartyId: 'p1', description: 'd', projectId: 'pr', isRecurring: true, tags: ['x'], fileUrls: ['u'] })
  })
})
