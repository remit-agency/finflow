import { beforeEach, describe, expect, it } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { confirmMatch, skipOccurrence, undoMatch } from '@/lib/server/ledger/plan-match'
import { createSeries, fillSeries } from '@/lib/server/ledger/series'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'
import { markDoc, txDoc } from './recurring-helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
// TODAY is 2026-10-27: the rent of the 27th is planned for today, the bank booked it the day before.
const RENT = parseSeriesInput({
  name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 27, startDate: '2026-10-01',
  categoryId: 'rent', tags: ['office'], description: 'Lokal 3',
})
const BANK = `bk_${KEY(1)}`
let seriesId = ''
let plan = ''

const versionOf = async (id: string) => (await db.doc(`organizations/${ORG}/transactions/${id}`).get()).updateTime as Timestamp
/** A stored document without the fields every write stamps anew. */
function stable(doc: Record<string, unknown> | undefined): Record<string, unknown> {
  const { updatedAt: _at, updatedBy: _by, ...rest } = doc ?? {}
  void _at
  void _by
  return rest
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
  await seedCategory(db, ORG, 'office-rent', 'expense')
  await seedTag(db, ORG, 'office')
  seriesId = (await createSeries(deps, ORG, UID, RENT)).series.id
  plan = `pl_${seriesId}_2026-10-27`
  await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
})

describe('confirming a match (S11)', () => {
  it('the bank operation stays and takes what it lacked; the plan goes; the occurrence is paid by it; no balance moves', async () => {
    const before = await balanceOf(db, ORG, 'mil')
    const done = await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK, versions: [await versionOf(plan), await versionOf(BANK)] })
    expect(done.bank).toMatchObject({ id: BANK, amountMinor: 250_000, paymentDate: '2026-10-26', categoryId: 'rent', tags: ['office'], description: 'Lokal 3', seriesId, occurrence: '2026-10-27' })
    expect(await txDoc(db, plan)).toBeUndefined()
    expect(await markDoc(db, plan)).toMatchObject({ reason: 'paid', txId: BANK, carried: { categoryId: 'rent', tags: ['office'], description: 'Lokal 3' }, by: UID })
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${KEY(1)}`)).toBeDefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(before)
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({ 'categories.rent.expenseBase': 250_000 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect((await auditActions(db, ORG)).filter((a) => a !== 'tx.create' && a !== 'recurring.create')).toEqual(['tx.delete', 'tx.update'])
    const viaPlan = await db.collection(`organizations/${ORG}/audit`).where('action', 'in', ['tx.update', 'tx.delete']).get()
    expect(viaPlan.docs.every((d) => d.get('via') === 'plan')).toBe(true)
  })

  it('keeps what the bank operation had already and the rules trace', async () => {
    await updateTransaction(deps, ORG, UID, BANK, { description: 'Czynsz X' }, { autoRules: [{ id: 'r1', name: 'Landlord' }] })
    const done = await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(done.bank).toMatchObject({ description: 'Czynsz X', categoryId: 'rent', autoRules: [{ id: 'r1', name: 'Landlord' }] })
    expect(await markDoc(db, plan)).toMatchObject({ carried: { categoryId: 'rent', tags: ['office'] } })
  })

  it('refuses a side changed since it was suggested, a second confirmation, and a pair that does not match', async () => {
    const versions: [Timestamp, Timestamp] = [await versionOf(plan), await versionOf(BANK)]
    await updateTransaction(deps, ORG, UID, BANK, { description: 'zmiana' })
    expect(await code(confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK, versions }))).toBe('conflict:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(await code(confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK }))).toBe('not_found:undefined')
    expect(await code(confirmMatch(deps, ORG, UID, { planId: `pl_${seriesId}_2026-11-27`, bankId: BANK }))).toBe('not_eligible:undefined')
  })
})

describe('undoing a match', () => {
  it('puts the plan back exactly and takes off what it carried', async () => {
    const planBefore = await txDoc(db, plan)
    const bankBefore = await txDoc(db, BANK)
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await undoMatch(deps, ORG, UID, plan)
    expect(stable(await txDoc(db, plan))).toEqual(stable(planBefore))
    expect(stable(await txDoc(db, BANK))).toEqual(stable(bankBefore))
    expect(await markDoc(db, plan)).toBeUndefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('leaves a field the person changed after the match', async () => {
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await updateTransaction(deps, ORG, UID, BANK, { categoryId: 'office-rent' })
    await undoMatch(deps, ORG, UID, plan)
    const bank = await txDoc(db, BANK)
    expect(bank).toMatchObject({ categoryId: 'office-rent' })
    expect(bank?.seriesId).toBeUndefined()
  })

  it('refuses when there is nothing to undo', async () => {
    expect(await code(undoMatch(deps, ORG, UID, plan))).toBe('not_found:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await undoMatch(deps, ORG, UID, plan)
    expect(await code(undoMatch(deps, ORG, UID, plan))).toBe('not_found:undefined')
  })
})

describe('«Пропустити цей раз»', () => {
  it('deletes the plan with a skipped mark; its undo through the create route restores it', async () => {
    const next = `pl_${seriesId}_2026-11-27`
    const before = await skipOccurrence(deps, ORG, UID, seriesId, '2026-11-27')
    expect(before).toMatchObject({ id: next, status: 'planned' })
    expect(await txDoc(db, next)).toBeUndefined()
    expect(await markDoc(db, next)).toMatchObject({ reason: 'skipped' })
    expect(await fillSeries(makeDeps(db, { today: () => '2026-11-27' }), ORG, seriesId)).toMatchObject({ due: true })
    expect(await txDoc(db, next)).toBeUndefined()
    const input = parseTransactionInput(
      { clientId: next, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, paymentDate: before.paymentDate, categoryId: 'rent', tags: ['office'], description: 'Lokal 3' },
      { internal: true },
    )
    await createTransaction(deps, ORG, UID, input)
    expect(await txDoc(db, next)).toMatchObject({ seriesId, occurrence: '2026-11-27', status: 'planned' })
    expect(await markDoc(db, next)).toBeUndefined()
  })

  it('refuses an occurrence that is no plan of the series', async () => {
    expect(await code(skipOccurrence(deps, ORG, UID, seriesId, '2026-11-28'))).toBe('not_found:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(await code(skipOccurrence(deps, ORG, UID, seriesId, '2026-10-27'))).toBe('not_found:undefined')
  })
})
