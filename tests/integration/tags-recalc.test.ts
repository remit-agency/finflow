import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { TagError } from '@/lib/domain/tags/errors'
import { parseTagInput, parseTagPatch } from '@/lib/domain/tags/input'
import type { RecalcStepResult, Tag } from '@/lib/domain/tags/types'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction } from '@/lib/server/ledger/write'
import { recalcStep } from '@/lib/server/tags/recalc'
import { createTag, updateTag } from '@/lib/server/tags/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

const expense = (paymentDate: string, tags: string[] = []) =>
  createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'bank', amountMinor: 1_000, paymentDate, categoryId: 'k-ex', tags }))

/** Every step until done, `size` operations a step. */
async function runAll(tag: Tag, size: number): Promise<RecalcStepResult[]> {
  const steps: RecalcStepResult[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const step = await recalcStep(deps, ORG, UID, tag.id, cursor, size)
    steps.push(step)
    if (step.done) return steps
    cursor = step.cursor
  }
  throw new Error('the recalculation never ends')
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof LedgerError || e instanceof TagError) return e.code
    return `other:${String(e)}`
  }
  return 'none'
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'bank', 'PLN', 100_000)
  await seedCategory(db, ORG, 'k-ex', 'expense')
})

describe('recalcStep', () => {
  it('a flag change recalculates the past in steps; afterwards verifyLedger is clean and rebuild finds nothing to change', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    for (let day = 10; day < 15; day++) await expense(`2026-10-${day}`, [tag.id])
    await expense('2026-10-20')
    const { recalc } = await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    expect(recalc).toBe(true)
    // Until the steps run, the stored flags are the old ones: verify sees the drift.
    expect((await verifyLedger(deps, ORG)).excludedDiffs).toHaveLength(5)

    const steps = await runAll(tag, 2)
    expect(steps.map((s) => [s.scanned, s.changed, s.done])).toEqual([
      [2, 2, false],
      [2, 2, false],
      [1, 1, true],
    ])
    expect(steps[2].cursor).toBeNull()
    expect((await readDoc(db, `organizations/${ORG}/tags/${tag.id}`))?.recalcPending).toBe(false)
    expect(await balanceOf(db, ORG, 'bank')).toBe(100_000 - 6 * 1_000)
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-10')).toEqual({ outMinor: 1_000, outBase: 1_000 })
    expect(await rollup(db, ORG, 'cash_bank_2026-10-10')).toEqual({})
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({ 'categories.k-ex.expenseBase': 1_000 })
    expect(await verifyLedger(deps, ORG)).toMatchObject({ ok: true, excludedDiffs: [], rollupDiffs: [], balanceDiffs: [] })
    expect(await rebuildLedger(deps, ORG, UID, { apply: true })).toMatchObject({ rollupDiffs: [], balanceDiffs: [], excludedDiffs: [] })
  })

  it('every recalculated operation has an audit entry tx.update via tag', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    const { transaction } = await expense('2026-10-10', [tag.id])
    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    await runAll(tag, 100)
    const entries = await db.collection(`organizations/${ORG}/audit`).where('targetId', '==', transaction.id).where('via', '==', 'tag').get()
    expect(entries.docs.map((d) => [d.get('action'), d.get('before').excluded, d.get('after').excluded])).toEqual([['tx.update', undefined, true]])
  })

  it('running the steps again changes nothing; switching the flag back empties the x_ rollups', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    await expense('2026-10-10', [tag.id])
    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    await runAll(tag, 100)
    expect((await runAll(tag, 100)).map((s) => s.changed)).toEqual([0])

    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: false }))
    expect((await runAll(tag, 100)).map((s) => s.changed)).toEqual([1])
    expect(await rollup(db, ORG, 'x_cash_bank_2026-10-10')).toEqual({})
    expect(await rollup(db, ORG, 'cash_bank_2026-10-10')).toEqual({ outMinor: 1_000, outBase: 1_000 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('an operation written during the recalculation already takes the new flag', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'Bankomat' }))
    await expense('2026-10-10', [tag.id])
    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    const during = await expense('2026-10-11', [tag.id])
    expect(during.transaction.excluded).toBe(true)
    const steps = await runAll(tag, 100)
    expect(steps).toEqual([{ scanned: 2, changed: 1, done: true, cursor: null }])
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('an unknown tag is not_found; a step during a rebuild is ledger_busy and keeps the flag pending', async () => {
    expect(await code(recalcStep(deps, ORG, UID, 'ghost', null))).toBe('not_found')
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    await expense('2026-10-10', [tag.id])
    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    const token = await acquireLock(deps, ORG, UID)
    expect(await code(recalcStep(deps, ORG, UID, tag.id, null))).toBe('ledger_busy')
    await releaseLock(deps, ORG, token)
    expect((await readDoc(db, `organizations/${ORG}/tags/${tag.id}`))?.recalcPending).toBe(true)
    await runAll(tag, 100)
    expect((await readDoc(db, `organizations/${ORG}/tags/${tag.id}`))?.recalcPending).toBe(false)
  })
})
