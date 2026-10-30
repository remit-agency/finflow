import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { BankInfo } from '@/lib/domain/ledger/types'
import { RuleError } from '@/lib/domain/rules/errors'
import type { ApplyStepResult, CheckStepResult } from '@/lib/domain/rules/types'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { applyStep, checkStep, previewRule } from '@/lib/server/rules/apply'
import { createRule } from '@/lib/server/rules/write'
import { ORG, UID, auditActions, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'
import { ruleInput } from './rule-helpers'

// The apply step writes through updateTransaction; a test may let a person's edit land just before one of those writes.
vi.mock('@/lib/server/ledger/write', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/ledger/write')>()
  return { ...real, updateTransaction: vi.fn(real.updateTransaction) }
})

const db = testDb()
const deps = makeDeps(db)
/** Small steps, so a handful of operations takes several of them. */
const SMALL = { scan: 3, apply: 2 }
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)
const next = (cursor: string | null): JournalKey | null => (cursor === null ? null : decodeCursor(cursor))

async function make(over: Record<string, unknown> = {}, bank?: BankInfo): Promise<string> {
  const input = parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 1_000, paymentDate: '2026-10-20', ...over })
  return (await createTransaction(deps, ORG, UID, input, bank)).transaction.id
}

/** Five operations the "orlen" rule may fill (one planned, one with the text only in its bank block) and four it may not. */
async function seedOperations() {
  return {
    m1: await make({ description: 'ORLEN Gdańsk', paymentDate: '2026-10-01' }),
    m2: await make({ description: 'Paliwo ORLEN', paymentDate: '2026-10-05' }),
    m3: await make({ paymentDate: '2026-10-07' }, { accountRef: 'ba1', counterpartyName: 'PKN ORLEN S.A.', remittance: 'Płatność kartą' }),
    m4: await make({ description: 'orlen myjnia', paymentDate: '2026-10-09' }),
    planned: await make({ description: 'ORLEN abonament', status: 'planned', paymentDate: '2026-11-05' }),
    manual: await make({ description: 'ORLEN', categoryId: 'k-other', paymentDate: '2026-10-11' }),
    coffee: await make({ description: 'Kawa', paymentDate: '2026-10-12' }),
    income: await make({ type: 'income', description: 'ORLEN zwrot', paymentDate: '2026-10-13' }),
    plain: await make({ paymentDate: '2026-10-14' }),
  }
}

async function checkAll() {
  const totals = { steps: 0, scanned: 0, matchOps: 0, categories: 0, counterparties: 0 }
  let cursor: JournalKey | null = null
  for (let i = 0; i < 50; i++) {
    const r: CheckStepResult = await checkStep(deps, ORG, cursor, SMALL)
    totals.steps++
    totals.scanned += r.scanned
    totals.matchOps += r.matchOps
    totals.categories += r.categories
    totals.counterparties += r.counterparties
    if (r.done) return totals
    cursor = next(r.cursor)
  }
  throw new Error('check did not finish')
}

async function applyAll() {
  const totals = { steps: 0, changed: 0, failed: 0, mostInOneStep: 0 }
  let cursor: JournalKey | null = null
  for (let i = 0; i < 50; i++) {
    const r: ApplyStepResult = await applyStep(deps, ORG, UID, cursor, SMALL)
    totals.steps++
    totals.changed += r.changed
    totals.failed += r.failed
    totals.mostInOneStep = Math.max(totals.mostInOneStep, r.changed + r.failed)
    if (r.done) return totals
    cursor = next(r.cursor)
  }
  throw new Error('apply did not finish')
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 100_000)
  await seedCategory(db, ORG, 'k-fuel', 'expense')
  await seedCategory(db, ORG, 'k-other', 'expense')
  await seedCounterparty(db, ORG, 'cp-orlen')
})

describe('check', () => {
  it('counts over several steps what the rules would fill, and writes nothing', async () => {
    await seedOperations()
    await createRule(deps, ORG, UID, ruleInput())
    const before = await auditActions(db, ORG)
    const totals = await checkAll()
    expect(totals).toMatchObject({ scanned: 9, matchOps: 5, categories: 5, counterparties: 0 })
    expect(totals.steps).toBeGreaterThanOrEqual(3)
    expect(await auditActions(db, ORG)).toEqual(before)
  })

  it('without rules a step reads nothing and is done', async () => {
    await seedOperations()
    expect(await checkStep(deps, ORG, null)).toEqual({ scanned: 0, matchOps: 0, categories: 0, counterparties: 0, tags: 0, done: true, cursor: null })
  })
})

describe('apply', () => {
  it('fills the matching operations step by step, at most the step limit at a time, with the trace and via rule', async () => {
    const ids = await seedOperations()
    const rule = await createRule(deps, ORG, UID, ruleInput())
    const totals = await applyAll()
    expect(totals).toMatchObject({ changed: 5, failed: 0 })
    expect(totals.mostInOneStep).toBeLessThanOrEqual(SMALL.apply)

    for (const id of [ids.m1, ids.m2, ids.m3, ids.m4, ids.planned]) {
      expect(await txDoc(id)).toMatchObject({ categoryId: 'k-fuel', autoRules: [{ id: rule.id, name: 'Paliwo' }] })
    }
    // A person's category, another text, the other type and no text at all: untouched.
    expect(await txDoc(ids.manual)).toMatchObject({ categoryId: 'k-other' })
    expect((await txDoc(ids.manual))?.autoRules).toBeUndefined()
    for (const id of [ids.coffee, ids.income, ids.plain]) expect((await txDoc(id))?.categoryId).toBeUndefined()

    const updates = (await db.collection(`organizations/${ORG}/audit`).where('action', '==', 'tx.update').get()).docs.map((d) => d.data())
    expect(updates).toHaveLength(5)
    for (const entry of updates) expect(entry).toMatchObject({ via: 'rule' })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a second run changes nothing', async () => {
    await seedOperations()
    await createRule(deps, ORG, UID, ruleInput())
    await applyAll()
    expect(await applyAll()).toMatchObject({ changed: 0, failed: 0 })
  })

  it('a person edit that lands between the step read and its write wins: a conflict, counted as failed, nothing overwritten', async () => {
    const ids = await seedOperations()
    await createRule(deps, ORG, UID, ruleInput())
    const actual = await vi.importActual<typeof import('@/lib/server/ledger/write')>('@/lib/server/ledger/write')
    // The first write of the step is preceded by the person's edit of that same operation (no version check: a person).
    const edited: string[] = []
    vi.mocked(updateTransaction).mockImplementation(async (d, org, uid, id, patch, extras) => {
      if (edited.length === 0) {
        edited.push(id)
        await actual.updateTransaction(d, org, UID, id, { categoryId: 'k-other' })
      }
      return actual.updateTransaction(d, org, uid, id, patch, extras)
    })
    try {
      const totals = await applyAll()
      expect(totals).toMatchObject({ changed: 4, failed: 1 })
      const person = edited[0]
      expect([ids.m1, ids.m2, ids.m3, ids.m4, ids.planned]).toContain(person)
      expect(await txDoc(person)).toMatchObject({ categoryId: 'k-other' })
      expect((await txDoc(person))?.autoRules).toBeUndefined()
      expect((await txDoc(person))?.counterpartyId).toBeUndefined()
      const updates = (await db.collection(`organizations/${ORG}/audit`).where('action', '==', 'tx.update').where('targetId', '==', person).get()).docs.map((d) => d.data())
      expect(updates.map((u) => u.via ?? null)).toEqual([null])
      expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    } finally {
      vi.mocked(updateTransaction).mockImplementation(actual.updateTransaction)
    }
  })

  it('fills only the empty field: an operation with a person\'s category gets just the counterparty', async () => {
    const ids = await seedOperations()
    const rule = await createRule(deps, ORG, UID, ruleInput({ actions: { categoryId: 'k-fuel', counterpartyId: 'cp-orlen' } }))
    await applyAll()
    expect(await txDoc(ids.manual)).toMatchObject({ categoryId: 'k-other', counterpartyId: 'cp-orlen', autoRules: [{ id: rule.id, name: 'Paliwo' }] })
    expect(await txDoc(ids.m1)).toMatchObject({ categoryId: 'k-fuel', counterpartyId: 'cp-orlen' })
  })
})

describe('previewRule', () => {
  it('counts the operations without a category or counterparty the draft rule would fill, and writes nothing', async () => {
    await seedOperations()
    const before = await auditActions(db, ORG)
    // Every one of the 9 lacks a counterparty; 5 of them would get the category.
    expect(await previewRule(deps, ORG, ruleInput())).toEqual({ matched: 5, scanned: 9, capped: false })
    expect(await auditActions(db, ORG)).toEqual(before)
  })

  it('says when it read only the latest operations', async () => {
    await seedOperations()
    const r = await previewRule(deps, ORG, ruleInput(), 4)
    expect(r.capped).toBe(true)
    expect(r.scanned).toBeLessThanOrEqual(4)
  })

  it('refuses an unknown company', async () => {
    await expect(previewRule(deps, 'ghost', ruleInput())).rejects.toBeInstanceOf(RuleError)
  })
})
