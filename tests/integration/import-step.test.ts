import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import type { ImportOp } from '@/lib/domain/import/types'
import type { ImportStepRequest } from '@/lib/domain/import/request'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { parseTransactionInput, type TransactionInput } from '@/lib/domain/ledger/input'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { syncStep } from '@/lib/server/banking/sync'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { importKey } from '@/lib/server/imports/key'
import { importStep } from '@/lib/server/imports/step'
import { acquireLock, releaseLock } from '@/lib/server/ledger/lock'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { createRule } from '@/lib/server/rules/write'
import { ruleInput } from './rule-helpers'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const NOW = new Date('2026-10-27T10:00:00Z')
const txPath = (id: string) => `organizations/${ORG}/transactions/${id}`
const seenPath = (key: string) => `organizations/${ORG}/bankSeen/${key}`
const lockPath = `organizations/${ORG}/importLocks/a1`

function depsFor(): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

/** A statement line of the file, as the preview sends it (the ordinal is the parser's). */
function line(over: Partial<ImportOp> = {}): ImportOp {
  return { day: '2026-10-20', type: 'income', amountMinor: 10_000, reference: 'R1', counterpartyName: 'ACME', remittance: 'Faktura 12/10', ordinal: 0, ...over }
}
const SECOND = line({ day: '2026-10-21', type: 'expense', amountMinor: 4_000, reference: 'R2', counterpartyName: 'Klient', remittance: 'Zakup', ordinal: 0 })

function statement(over: Partial<ImportStepRequest['statement']> = {}): ImportStepRequest['statement'] {
  return { source: 'PL61109010140000071219812874', currency: 'PLN', from: '2026-10-20', to: '2026-10-21', closingMinor: null, complete: true, ...over }
}

function step(over: Partial<ImportStepRequest> = {}): ImportStepRequest {
  return { fileName: 'wyciag.sta', accountId: 'a1', statement: statement(), operations: [line(), SECOND], last: false, ...over }
}

const importDoc = (id: string) => readDoc(db, `organizations/${ORG}/imports/${id}`)
const seenCount = async () => (await db.collection(`organizations/${ORG}/bankSeen`).get()).size

/** The stored operation as the browser has it (the undo toast keeps it). */
async function storedAsUi(id: string) {
  const tx = parseTransaction(id, (await db.doc(txPath(id)).get()).data())
  if (!tx) throw new Error('unreadable operation')
  return toUiTransaction(ORG, tx)
}

/** The undo of a delete, as the browser sends it: the draft with its id as clientId, parsed with `internal: true`. */
function undoInput(ui: Awaited<ReturnType<typeof storedAsUi>>): TransactionInput {
  return parseTransactionInput(JSON.parse(JSON.stringify(draftToBody(transactionToDraft(ui), ui.id))), { internal: true })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

describe('importStep: writes the operations of a statement', () => {
  it('creates the operations with their marks, moves the balance and records the import', async () => {
    const res = await importStep(depsFor(), ORG, UID, step())
    expect(res).toMatchObject({ created: 2, skipped: { seen: 0, bank: 0 }, refused: [], done: false })

    for (const op of [line(), SECOND]) {
      const key = importKey('a1', op)
      expect(await readDoc(db, txPath(`bk_${key}`))).toMatchObject({ source: 'bank', type: op.type, amountMinor: op.amountMinor, paymentDate: op.day })
      const tx = await readDoc(db, txPath(`bk_${key}`))
      expect((tx?.bank as Record<string, unknown>).importId).toBe(res.importId)
      expect(tx?.bank).not.toHaveProperty('accountRef')
      expect(await readDoc(db, seenPath(key))).toMatchObject({
        txId: `bk_${key}`,
        bank: { importId: res.importId },
        snapshot: { type: op.type, accountId: 'a1', amountMinor: op.amountMinor, paymentDate: op.day },
      })
    }
    expect(await balanceOf(db, ORG, 'a1')).toBe(6_000)
    expect(await importDoc(res.importId)).toMatchObject({ counts: { created: 2, skipped: 0, refused: 0 }, accountIds: ['a1'] })
  })

  it('a repeat of the same step skips both lines; the same file as a new import creates nothing and gets a second import', async () => {
    const first = await importStep(depsFor(), ORG, UID, step())
    const again = await importStep(depsFor(), ORG, UID, step({ importId: first.importId }))
    expect(again).toMatchObject({ created: 0, skipped: { seen: 2, bank: 0 } })

    const other = await importStep(depsFor(), ORG, UID, step())
    expect(other).toMatchObject({ created: 0, skipped: { seen: 2, bank: 0 } })
    expect(other.importId).not.toBe(first.importId)
    expect((await db.collection(`organizations/${ORG}/imports`).get()).size).toBe(2)
    expect(await balanceOf(db, ORG, 'a1')).toBe(6_000)
  })

  it('two identical lines are two operations; after both exist, sending only the second one skips it', async () => {
    const twins = [line({ ordinal: 0 }), line({ ordinal: 1 })]
    const res = await importStep(depsFor(), ORG, UID, step({ operations: twins }))
    expect(res.created).toBe(2)
    expect(importKey('a1', twins[0])).not.toBe(importKey('a1', twins[1]))
    expect(await readDoc(db, txPath(`bk_${importKey('a1', twins[1])}`))).toBeDefined()

    const only = await importStep(depsFor(), ORG, UID, step({ operations: [line({ ordinal: 1 })] }))
    expect(only).toMatchObject({ created: 0, skipped: { seen: 1, bank: 0 } })
  })

  it('refuses a future day, a zero amount and another currency: nothing written, no marks, counted as refused', async () => {
    const future = await importStep(depsFor(), ORG, UID, step({ operations: [line({ day: '2026-10-28' }), line({ amountMinor: 0, reference: 'R9' })] }))
    expect(future.created).toBe(0)
    expect(future.refused).toEqual([
      { day: '2026-10-28', amountMinor: 10_000, reason: 'future_date' },
      { day: '2026-10-20', amountMinor: 0, reason: 'amount' },
    ])
    expect(await importDoc(future.importId)).toMatchObject({ counts: { created: 0, skipped: 0, refused: 2 } })

    const eur = await importStep(depsFor(), ORG, UID, step({ statement: statement({ currency: 'EUR' }), operations: [line()] }))
    expect(eur.refused).toEqual([{ day: '2026-10-20', amountMinor: 10_000, reason: 'currency_mismatch' }])

    expect(await seenCount()).toBe(0)
    expect((await db.collection(`organizations/${ORG}/transactions`).get()).size).toBe(0)
    expect(await balanceOf(db, ORG, 'a1')).toBe(0)
  })

  it('an auto-rule fills the category of a file operation (S10)', async () => {
    const deps = depsFor()
    await seedCategory(db, ORG, 'k-fuel', 'expense')
    await createRule(deps.ledger, ORG, UID, ruleInput({ name: 'Paliwo', type: 'expense', conditions: [{ kind: 'text', op: 'contains', values: ['zakup'] }], actions: { categoryId: 'k-fuel' } }))

    const res = await importStep(deps, ORG, UID, step({ operations: [SECOND] }))
    expect(res.created).toBe(1)
    expect(await readDoc(db, txPath(`bk_${importKey('a1', SECOND)}`))).toMatchObject({ categoryId: 'k-fuel', autoRules: [{ name: 'Paliwo' }] })
  })

  it('a bank-linked account: a line the bank sync already wrote (same day, direction, amount, no reference) is skipped as bank; another amount is written', async () => {
    await seedBank(db)
    await syncStep(bankDeps(db, fakeEb({ '': { transactions: [ebTx('EB1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null } }, '100.00')), ORG, UID, 'ba1')

    const res = await importStep(depsFor(), ORG, UID, step({ operations: [line({ reference: null }), line({ reference: null, amountMinor: 9_999, remittance: 'Inna' })] }))
    expect(res).toMatchObject({ created: 1, skipped: { seen: 0, bank: 1 }, refused: [] })
    // A skipped bank overlap is not marked: the file line stays a candidate on the next import.
    expect(await readDoc(db, seenPath(importKey('a1', line({ reference: null }))))).toBeUndefined()

    // Known risk (spec decision 2): both sides with a reference that differ are not recognised as the same operation.
    const withRef = await importStep(depsFor(), ORG, UID, step({ operations: [line({ reference: 'MT-REF-1' })] }))
    expect(withRef).toMatchObject({ created: 1, skipped: { bank: 0 } })
  })

  it('one bank operation covers one file line: of two identical lines, one is skipped as bank and the other is written', async () => {
    await seedBank(db)
    await syncStep(bankDeps(db, fakeEb({ '': { transactions: [ebTx('EB1', '100.00', 'CRDT', '2026-10-20')], continuationKey: null } }, '100.00')), ORG, UID, 'ba1')

    const twins = [line({ reference: null, ordinal: 0 }), line({ reference: null, ordinal: 1 })]
    const res = await importStep(depsFor(), ORG, UID, step({ operations: twins }))
    expect(res).toMatchObject({ created: 1, skipped: { seen: 0, bank: 1 }, refused: [] })
  })

  it('refuses while another holder has the lock, takes over an expired lock, and releases the lock after a step and after an error', async () => {
    await db.doc(lockPath).set({ until: NOW.getTime() + 30_000, token: 'other' })
    await expect(importStep(depsFor(), ORG, UID, step())).rejects.toMatchObject({ code: 'already_running' })
    expect(await readDoc(db, lockPath)).toMatchObject({ token: 'other' }) // the failed call did not release it

    await db.doc(lockPath).set({ until: 0, token: 'old' })
    const res = await importStep(depsFor(), ORG, UID, step({ last: false }))
    expect(res.created).toBe(2)
    expect(await readDoc(db, lockPath)).toMatchObject({ token: null })

    // A ledger lease that makes the ledger busy aborts the step; the import lock is still released.
    const deps = depsFor()
    const ledgerToken = await acquireLock(deps.ledger, ORG, 'test')
    await expect(importStep(deps, ORG, UID, step({ operations: [line({ reference: 'R7' })] }))).rejects.toMatchObject({ code: 'ledger_busy' })
    await releaseLock(deps.ledger, ORG, ledgerToken)
    expect(await readDoc(db, lockPath)).toMatchObject({ token: null })
  })

  it('fits the opening balance of an empty account at the last step; an account with operations is not fitted', async () => {
    const deps = depsFor()
    const first = await importStep(deps, ORG, UID, step({ last: false }))
    expect(first).toMatchObject({ balanceMinor: null, closingMinor: null, differenceMinor: null, fitted: false })
    expect(await importDoc(first.importId)).toMatchObject({ fit: { a1: 'pending' } })

    const last = await importStep(deps, ORG, UID, step({
      importId: first.importId,
      last: true,
      statement: statement({ closingMinor: 137_950 }),
      operations: [line({ reference: 'R3', amountMinor: 2_000, ordinal: 0 })],
    }))
    expect(last).toMatchObject({ done: true, fitted: true, balanceMinor: 137_950, closingMinor: 137_950, differenceMinor: 0 })
    expect(await readDoc(db, `organizations/${ORG}/accounts/a1`)).toMatchObject({ openingMinor: 129_950, balanceMinor: 137_950 })
    expect(await importDoc(first.importId)).toMatchObject({ fit: { a1: 'done' } })

    // An account that already had an operation keeps its opening balance; the difference is reported.
    await seedAccount(db, ORG, 'a2', 'PLN', 0)
    await createTransaction(deps.ledger, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'a2', amountMinor: 5_000, paymentDate: '2026-10-20', clientId: 'manual-1' }))
    // Balance: -5000 (manual) + 10000 (the line) = 5000; the statement says 100000.
    const busy = await importStep(deps, ORG, UID, step({ accountId: 'a2', statement: statement({ closingMinor: 100_000 }), operations: [line({ reference: 'R5' })], last: true }))
    expect(busy).toMatchObject({ fitted: false, balanceMinor: 5_000, closingMinor: 100_000, differenceMinor: -95_000 })
    expect(await readDoc(db, `organizations/${ORG}/accounts/a2`)).toMatchObject({ openingMinor: 0, balanceMinor: 5_000 })
    expect(await importDoc(busy.importId)).toMatchObject({ fit: { a2: 'no' } })
  })

  it('does not fit the opening balance from a statement of another currency, nor from a statement with no lines', async () => {
    const eur = await importStep(depsFor(), ORG, UID, step({ statement: statement({ currency: 'EUR', closingMinor: 500_000 }), operations: [], last: true }))
    expect(eur).toMatchObject({ fitted: false, done: true, closingMinor: 500_000 })
    expect(await readDoc(db, `organizations/${ORG}/accounts/a1`)).toMatchObject({ openingMinor: 0 })
    expect(await importDoc(eur.importId)).toMatchObject({ fit: { a1: 'pending' } })
  })

  it('fits only a statement the client marks complete; an incomplete one reports its difference and keeps the opening', async () => {
    const incomplete = await importStep(depsFor(), ORG, UID, step({
      statement: statement({ closingMinor: 137_950, complete: false }),
      operations: [line({ reference: 'R3', amountMinor: 2_000 })],
      last: true,
    }))
    expect(incomplete).toMatchObject({ fitted: false, balanceMinor: 2_000, closingMinor: 137_950, differenceMinor: -135_950 })
    expect(await readDoc(db, `organizations/${ORG}/accounts/a1`)).toMatchObject({ openingMinor: 0 })
  })

  it('an unknown account is account_not_found; an unknown import is not_found', async () => {
    await expect(importStep(depsFor(), ORG, UID, step({ accountId: 'nope' }))).rejects.toMatchObject({ code: 'account_not_found' })
    await expect(importStep(depsFor(), ORG, UID, step({ importId: 'missing-import' }))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('leaves the ledger without drift after writes, skips, refusals and a fit', async () => {
    const deps = depsFor()
    const first = await importStep(deps, ORG, UID, step({ operations: [line(), SECOND, line({ day: '2026-10-28' })] }))
    await importStep(deps, ORG, UID, step({ importId: first.importId }))
    await importStep(deps, ORG, UID, step({ importId: first.importId, last: true, statement: statement({ closingMinor: 6_000 }), operations: [] }))
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('a file operation is bank-locked: its amount cannot change, and an undo of its delete brings back its import block', async () => {
    const deps = depsFor()
    const res = await importStep(deps, ORG, UID, step({ operations: [line()] }))
    const id = `bk_${importKey('a1', line())}`

    await expect(updateTransaction(deps.ledger, ORG, UID, id, { amountMinor: 9_999 })).rejects.toMatchObject({ code: 'bank_locked' })

    const ui = await storedAsUi(id)
    await deleteTransaction(deps.ledger, ORG, UID, id)
    expect(await readDoc(db, txPath(id))).toBeUndefined()
    await createTransaction(deps.ledger, ORG, UID, undoInput(ui))
    expect(await readDoc(db, txPath(id))).toMatchObject({ source: 'bank', amountMinor: 10_000, bank: { importId: res.importId, entryReference: 'R1' } })
    expect(await balanceOf(db, ORG, 'a1')).toBe(10_000)
  })
})
