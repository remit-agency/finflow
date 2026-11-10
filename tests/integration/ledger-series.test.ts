import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { parseSeriesInput, parseSeriesPatch, type SeriesInput } from '@/lib/domain/recurring/input'
import { deleteAccount } from '@/lib/server/ledger/accounts'
import { createSeries, deleteSeries, fillSeries, updateSeries } from '@/lib/server/ledger/series'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'
import { markDoc, txDoc } from './recurring-helpers'

const db = testDb()
const deps = makeDeps(db)
const on = (today: string) => makeDeps(db, { today: () => today })
// TODAY is 2026-10-27: the window reaches 2027-01-27.
const RENT: SeriesInput = parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-10-01', categoryId: 'rent' })
const ZUS: SeriesInput = parseSeriesInput({ name: 'ZUS', kind: 'expense', accountId: 'mil', amountMinor: 150_000, frequency: 'monthly', startDate: '2026-10-01', preset: 'zus' })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError || e instanceof RecurringError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

/** The planned operations of a series, by id. */
async function plansOf(seriesId: string): Promise<string[]> {
  const snap = await db.collection(`organizations/${ORG}/transactions`).where('seriesId', '==', seriesId).get()
  return snap.docs.filter((d) => d.get('status') === 'planned').map((d) => d.id).sort()
}

const ids = (seriesId: string, days: string[]) => days.map((d) => `pl_${seriesId}_${d}`)
const seriesDoc = (id: string) => readDoc(db, `organizations/${ORG}/recurring/${id}`)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
})

describe('creating a series (S11)', () => {
  it('writes the series and the plans of the next three months under deterministic ids; nothing moves', async () => {
    const { series, created } = await createSeries(deps, ORG, UID, RENT)
    expect(created).toBe(3)
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10']))
    expect(await txDoc(db, `pl_${series.id}_2026-11-10`)).toMatchObject({
      status: 'planned', type: 'expense', amountMinor: 250_000, categoryId: 'rent', paymentDate: '2026-11-10', isRecurring: false,
      seriesId: series.id, occurrence: '2026-11-10', createdBy: UID,
    })
    expect(await seriesDoc(series.id)).toMatchObject({ name: 'Czynsz', currency: 'PLN', status: 'active', generatedThrough: '2027-01-27', dueOn: '2026-10-28', version: 1, createdBy: UID })
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
    expect((await db.collection(`organizations/${ORG}/rollups`).get()).size).toBe(0)
    expect(await auditActions(db, ORG)).toEqual(['recurring.create', 'tx.create', 'tx.create', 'tx.create'])
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('moves a weekend day to the next business day and keeps the occurrence in the id', async () => {
    const { series } = await createSeries(deps, ORG, UID, { ...RENT, dayOfMonth: 15, weekendRule: 'next' })
    expect(await txDoc(db, `pl_${series.id}_2026-11-15`)).toMatchObject({ paymentDate: '2026-11-16', occurrence: '2026-11-15' })
  })

  it('refuses a missing account or category, and a series beyond the limit', async () => {
    expect(await code(createSeries(deps, ORG, UID, { ...RENT, accountId: 'nope' }))).toBe('account_not_found:accountId')
    expect(await code(createSeries(deps, ORG, UID, { ...RENT, categoryId: 'nope' }))).toBe('category_not_found:categoryId')
    await createSeries(deps, ORG, UID, RENT, { maxCount: 1 })
    expect(await code(createSeries(deps, ORG, UID, RENT, { maxCount: 1 }))).toBe('limit_reached:undefined')
  })

  it('a preset takes the ZUS record of S06, creating it once when the company has none', async () => {
    const first = await createSeries(deps, ORG, UID, ZUS)
    expect(first.series).toMatchObject({ counterpartyId: 'system_zus', estimated: true, weekendRule: 'next', dayOfMonth: 15 })
    expect(await readDoc(db, `organizations/${ORG}/counterparties/system_zus`)).toMatchObject({ name: 'ZUS', kind: 'zus' })
    expect((await createSeries(deps, ORG, UID, ZUS)).series.counterpartyId).toBe('system_zus')
    expect((await db.collection(`organizations/${ORG}/counterparties`).get()).size).toBe(1)
    expect(await txDoc(db, `pl_${first.series.id}_2026-11-15`)).toMatchObject({ counterpartyId: 'system_zus', estimated: true, paymentDate: '2026-11-16' })
  })

  it('a preset whose name a person already took uses that record, not a duplicate', async () => {
    await seedCounterparty(db, ORG, 'my-zus')
    await db.doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'my-zus' })
    expect((await createSeries(deps, ORG, UID, ZUS)).series.counterpartyId).toBe('my-zus')
  })

  // The editor of the page sends the preset's system id (`system_zus`) as the counterparty. The server owns that choice.
  it('a preset sent with the system id creates the S06 record in a company that has none (I1)', async () => {
    const { series } = await createSeries(deps, ORG, UID, { ...ZUS, counterpartyId: 'system_zus' })
    expect(series.counterpartyId).toBe('system_zus')
    expect(await readDoc(db, `organizations/${ORG}/counterparties/system_zus`)).toMatchObject({ name: 'ZUS', kind: 'zus' })
  })

  it('a preset sent with the system id uses the company’s own ZUS record, creating no system one (I1)', async () => {
    await seedCounterparty(db, ORG, 'my-zus')
    await db.doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'my-zus' })
    expect((await createSeries(deps, ORG, UID, { ...ZUS, counterpartyId: 'system_zus' })).series.counterpartyId).toBe('my-zus')
    expect(await readDoc(db, `organizations/${ORG}/counterparties/system_zus`)).toBeUndefined()
  })

  it('a preset whose system record is archived is refused, never planned without its counterparty (I1)', async () => {
    await seedCounterparty(db, ORG, 'system_zus', { archived: true })
    await db.doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'system_zus' })
    expect(await code(createSeries(deps, ORG, UID, { ...ZUS, counterpartyId: 'system_zus' }))).toBe('counterparty_archived:counterpartyId')
    expect(await code(createSeries(deps, ORG, UID, ZUS))).toBe('counterparty_archived:counterpartyId')
  })
})

describe('the daily fill', () => {
  it('is not due again the same day; the next day it adds only what the window gained', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await fillSeries(deps, ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: true, created: 1 })
    expect(await plansOf(series.id)).toContain(`pl_${series.id}_2027-02-10`)
    expect(await seriesDoc(series.id)).toMatchObject({ generatedThrough: '2027-02-27', dueOn: '2026-11-28', version: 1 })
  })

  it('two fills at once and a fill repeated create nothing twice', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const runs = await Promise.all([fillSeries(on('2026-11-27'), ORG, series.id), fillSeries(on('2026-11-27'), ORG, series.id)])
    expect(runs.map((r) => r.created).sort()).toEqual([0, 1])
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await plansOf(series.id)).toHaveLength(4)
  })

  it('catches up after weeks without a call: the missed occurrences come as overdue plans', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect((await fillSeries(on('2027-04-01'), ORG, series.id)).created).toBe(5)
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10', '2027-06-10']))
  })

  it('never creates an occurrence that already has a mark', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const id = `pl_${series.id}_2027-02-10`
    await db.doc(`organizations/${ORG}/recurringDone/${id}`).set({ schemaVersion: 1, seriesId: series.id, occurrence: '2027-02-10', reason: 'skipped', estimated: false, manual: false })
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: true, created: 0 })
    expect(await txDoc(db, id)).toBeUndefined()
  })

  it('a deleted category stays out of the new plans; the series still fills', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await db.doc(`organizations/${ORG}/categories/rent`).delete()
    await fillSeries(on('2026-11-27'), ORG, series.id)
    expect((await txDoc(db, `pl_${series.id}_2027-02-10`))?.categoryId).toBeUndefined()
  })
})

describe('changing a series', () => {
  it('rewrites the future unpaid plans, not the paid or hand-changed ones', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const [nov, dec, jan] = ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10'])
    await updateTransaction(deps, ORG, UID, nov, { status: 'actual', paymentDate: TODAY })
    await updateTransaction(deps, ORG, UID, dec, { description: 'grudzień' })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ amountMinor: 260_000 }))).toMatchObject({ created: 0, updated: 1, deleted: 0 })
    expect(await txDoc(db, jan)).toMatchObject({ amountMinor: 260_000, status: 'planned' })
    expect(await txDoc(db, dec)).toMatchObject({ amountMinor: 250_000, manual: true })
    expect(await txDoc(db, nov)).toMatchObject({ amountMinor: 250_000, status: 'actual' })
    expect(await seriesDoc(series.id)).toMatchObject({ amountMinor: 260_000, version: 2 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a new day moves the unpaid plans to their new dates; a month already paid gets no second plan', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateTransaction(deps, ORG, UID, `pl_${series.id}_2026-11-10`, { status: 'actual', paymentDate: TODAY })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ dayOfMonth: 20 }))).toMatchObject({ created: 2, updated: 0, deleted: 2 })
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-12-20', '2027-01-20']))
    expect(await markDoc(db, `pl_${series.id}_2026-12-10`)).toBeUndefined()
  })

  it('a change on the payment day of a weekend-shifted occurrence updates its plan, it is not deleted (C1)', async () => {
    // ZUS on the 15th, next business day: 15 November 2026 is a Sunday, so the plan is due on Monday the 16th.
    const { series } = await createSeries(deps, ORG, UID, ZUS)
    const id = `pl_${series.id}_2026-11-15`
    expect(await txDoc(db, id)).toMatchObject({ paymentDate: '2026-11-16', amountMinor: 150_000 })
    const changed = await updateSeries(on('2026-11-16'), ORG, UID, series.id, parseSeriesPatch({ amountMinor: 160_000 }))
    expect(changed.deleted).toBe(0)
    expect(await txDoc(db, id)).toMatchObject({ amountMinor: 160_000, paymentDate: '2026-11-16', status: 'planned', seriesId: series.id, occurrence: '2026-11-15' })
    expect(await markDoc(db, id)).toBeUndefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('an occurrence a person deleted is not planned again by a change', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await deleteTransaction(deps, ORG, UID, `pl_${series.id}_2026-12-10`)
    await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ amountMinor: 260_000 }))
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2027-01-10']))
  })

  it('a pause stops the fill and may remove the future plans; resuming plans the window again', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const paused = await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'paused', removeFuture: true }))
    expect(paused).toMatchObject({ deleted: 3, series: { status: 'paused' } })
    expect(paused.series.dueOn).toBeUndefined()
    expect(await plansOf(series.id)).toEqual([])
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'active' }))).toMatchObject({ created: 3, series: { status: 'active', dueOn: '2026-10-28' } })
  })

  it('refuses a new category that does not exist; an unchanged deleted one does not block a change', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await code(updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ categoryId: 'nope' })))).toBe('category_not_found:categoryId')
    await db.doc(`organizations/${ORG}/categories/rent`).delete()
    expect(await code(updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ name: 'Czynsz biuro' })))).toBe('none')
  })

  it('an unknown series is not found', async () => {
    expect(await code(updateSeries(deps, ORG, UID, 'nope', parseSeriesPatch({ name: 'x' })))).toBe('not_found:undefined')
  })
})

describe('a planned occurrence is never a transfer (C2)', () => {
  it('an edit that turns it into a transfer is refused, and the operation and the balances stay as they were', async () => {
    await seedAccount(db, ORG, 'cash', 'PLN', 0)
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const id = `pl_${series.id}_2026-11-10`
    const before = await txDoc(db, id)
    expect(await code(updateTransaction(deps, ORG, UID, id, { type: 'transfer', toAccountId: 'cash', categoryId: null }))).toBe('series_transfer:type')
    expect(await txDoc(db, id)).toEqual(before)
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
    expect(await balanceOf(db, ORG, 'cash')).toBe(0)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a paid one is refused the same way', async () => {
    await seedAccount(db, ORG, 'cash', 'PLN', 0)
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const id = `pl_${series.id}_2026-11-10`
    await updateTransaction(deps, ORG, UID, id, { status: 'actual', paymentDate: TODAY })
    expect(await code(updateTransaction(deps, ORG, UID, id, { type: 'transfer', toAccountId: 'cash', categoryId: null }))).toBe('series_transfer:type')
    expect(await txDoc(db, id)).toMatchObject({ type: 'expense', seriesId: series.id, status: 'actual' })
  })
})

describe('deleting a series', () => {
  it('deletes the future unpaid plans by default and keeps the paid ones', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateTransaction(deps, ORG, UID, `pl_${series.id}_2026-11-10`, { status: 'actual', paymentDate: TODAY })
    expect(await deleteSeries(deps, ORG, UID, series.id, 'delete')).toEqual({ deleted: 2 })
    expect(await seriesDoc(series.id)).toBeUndefined()
    expect(await txDoc(db, `pl_${series.id}_2026-11-10`)).toMatchObject({ status: 'actual', seriesId: series.id })
    expect(await plansOf(series.id)).toEqual([])
    expect(await balanceOf(db, ORG, 'mil')).toBe(250_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('keeps them when asked', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await deleteSeries(deps, ORG, UID, series.id, 'keep')).toEqual({ deleted: 0 })
    expect(await plansOf(series.id)).toHaveLength(3)
  })
})

describe('an account a series uses', () => {
  it('cannot be deleted while the series lives, even without operations', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'paused', removeFuture: true }))
    expect(await code(deleteAccount(deps, ORG, UID, 'mil'))).toBe('account_has_operations:recurring')
    await deleteSeries(deps, ORG, UID, series.id, 'delete')
    expect(await code(deleteAccount(deps, ORG, UID, 'mil'))).toBe('none')
  })
})
