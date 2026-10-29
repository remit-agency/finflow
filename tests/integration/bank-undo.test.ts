import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import { parseTransactionInput, type TransactionInput } from '@/lib/domain/ledger/input'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { bankTxKeys } from '@/lib/server/banking/key'
import { syncStep } from '@/lib/server/banking/sync'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, readDoc, seedAccount, seedOrg, testDb } from './helpers'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'

const db = testDb()
const txCol = () => db.collection(`organizations/${ORG}/transactions`)
const seenDoc = (key: string) => `organizations/${ORG}/bankSeen/${key}`

const R1 = ebTx('r1', '100.00', 'CRDT', '2026-10-20', { remittance_information: ['Faktura 12/10'] })
const R2 = ebTx('r2', '40.00', 'DBIT', '2026-10-21')
const KEY_R1 = bankTxKeys('ba1', [R1])[0].key
const BANK_ID_R1 = `bk_${KEY_R1}`

/** The stored operation as the browser has it (what the undo toast keeps). */
async function storedAsUi(id: string) {
  const snap = await txCol().doc(id).get()
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx) throw new Error('unreadable operation')
  return toUiTransaction(ORG, tx)
}

/**
 * The undo of a delete, the way the browser sends it: the draft of the operation with its id as clientId, as JSON, then the
 * server's parser. The create route parses with `internal: true` (that is the only difference from a client create).
 */
function undoInput(ui: Awaited<ReturnType<typeof storedAsUi>>, over: Record<string, unknown> = {}): TransactionInput {
  const body = { ...JSON.parse(JSON.stringify(draftToBody(transactionToDraft(ui), ui.id))), ...over }
  return parseTransactionInput(body, { internal: true })
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
  await seedBank(db)
})

async function importBoth() {
  const eb = fakeEb({ '': { transactions: [R1, R2], continuationKey: null } }, '60.00')
  const deps = bankDeps(db, eb)
  await syncStep(deps, ORG, UID, 'ba1')
  return deps
}

describe('the mark of an imported operation', () => {
  it('records the bank block and the locked fields the operation was imported with', async () => {
    await importBoth()
    expect(await readDoc(db, seenDoc(KEY_R1))).toMatchObject({
      txId: BANK_ID_R1,
      bank: { accountRef: 'ba1', entryReference: 'r1', counterpartyName: 'Klient', remittance: 'Faktura 12/10' },
      snapshot: { type: 'income', accountId: 'a1', amountMinor: 10_000, paymentDate: '2026-10-20' },
    })
  })
})

describe('undo of a deleted bank operation', () => {
  it('comes back under its own id, with source bank and its bank block, and the balance is restored', async () => {
    const deps = await importBoth()
    const before = await balanceOf(db, ORG, 'a1')
    const ui = await storedAsUi(BANK_ID_R1)
    await deleteTransaction(deps.ledger, ORG, UID, BANK_ID_R1)
    expect(await readDoc(db, `organizations/${ORG}/transactions/${BANK_ID_R1}`)).toBeUndefined()

    await createTransaction(deps.ledger, ORG, UID, undoInput(ui))
    expect(await readDoc(db, `organizations/${ORG}/transactions/${BANK_ID_R1}`)).toMatchObject({
      source: 'bank',
      type: 'income',
      amountMinor: 10_000,
      paymentDate: '2026-10-20',
      bank: { accountRef: 'ba1', entryReference: 'r1', counterpartyName: 'Klient', remittance: 'Faktura 12/10' },
    })
    expect(await balanceOf(db, ORG, 'a1')).toBe(before)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('a create that changes a locked field is refused (invalid_input on clientId) and writes nothing', async () => {
    const deps = await importBoth()
    const before = await balanceOf(db, ORG, 'a1')
    const ui = await storedAsUi(BANK_ID_R1)
    await deleteTransaction(deps.ledger, ORG, UID, BANK_ID_R1)
    const afterDelete = await balanceOf(db, ORG, 'a1')

    for (const over of [{ amountMinor: 9_999 }, { paymentDate: '2026-10-19' }, { type: 'expense' }, { status: 'planned' }]) {
      await expect(createTransaction(deps.ledger, ORG, UID, undoInput(ui, over))).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })
    }
    expect(await readDoc(db, `organizations/${ORG}/transactions/${BANK_ID_R1}`)).toBeUndefined()
    expect(await balanceOf(db, ORG, 'a1')).toBe(afterDelete)
    expect(afterDelete).toBe(before - 10_000)
  })

  it('a client create with a bank-prefixed id and no bank mark is refused, and so is one whose mark is a failure', async () => {
    const deps = await importBoth()
    const before = await balanceOf(db, ORG, 'a1')
    const body = { type: 'expense', accountId: 'a1', amountMinor: 500, paymentDate: '2026-10-20', status: 'actual' }
    const unknown = `bk_${'0'.repeat(32)}`
    await expect(createTransaction(deps.ledger, ORG, UID, parseTransactionInput({ ...body, clientId: unknown }, { internal: true }))).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })

    await db.doc(seenDoc('f'.repeat(32))).set({ txId: `bk_${'f'.repeat(32)}`, at: '2026-10-20T10:00:00.000Z', reason: 'invalid_input' })
    await expect(createTransaction(deps.ledger, ORG, UID, parseTransactionInput({ ...body, clientId: `bk_${'f'.repeat(32)}` }, { internal: true }))).rejects.toMatchObject({ code: 'invalid_input', field: 'clientId' })

    expect((await txCol().get()).size).toBe(2) // the two imported operations, nothing new
    expect(await balanceOf(db, ORG, 'a1')).toBe(before)
    expect((await verifyLedger(deps.ledger, ORG)).ok).toBe(true)
  })

  it('an ordinary create (no bank-prefixed id) is unchanged and gets no bank block', async () => {
    const deps = await importBoth()
    const id = await createTransaction(deps.ledger, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 500, paymentDate: '2026-10-20', clientId: 'manual-12345678' }))
    expect(id.transaction.id).toBe('manual-12345678')
    expect(await readDoc(db, `organizations/${ORG}/transactions/manual-12345678`)).not.toHaveProperty('bank')
  })
})
