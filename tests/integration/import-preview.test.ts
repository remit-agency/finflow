import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportStepRequest } from '@/lib/domain/import/request'
import { MAX_IMPORT_BYTES, MAX_IMPORT_OPS, type ImportOp } from '@/lib/domain/import/types'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { previewImport, type PreviewStatement } from '@/lib/server/imports/preview'
import { importStep } from '@/lib/server/imports/step'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'
import { seedBank } from './bank-helpers'

const db = testDb()
const NOW = new Date('2026-10-27T10:00:00Z')
const SOURCE = 'PL61109010140000071219812874'
const FILE = 'wyciag.sta'

// Three lines of one statement (opening 0 PLN): A income 100,00 on 20.10 (ref R1); B expense 40,00 on 21.10 (ref R2);
// C income 25,00 on 21.10 (ref R3). The closing balances below are the sums, so the statements add up.
const A = [':61:261020C100,NTRFR1', ':86:Faktura 12/10']
const B = [':61:261021D40,NTRFR2', ':86:Zakup']
const C = [':61:261021C25,NTRFR3', ':86:Zwrot']

/** One statement of an MT940 file. */
function statementText(lines: string[], closing: string, source = SOURCE): string {
  return [':20:STMT', `:25:${source}`, ':28C:1/1', ':60F:C261019PLN0,', ...lines, `:62F:${closing}`].join('\n')
}

function depsFor(): ImportDeps {
  const ledger = makeDeps(db, { now: () => NOW })
  return { db, ledger, now: ledger.now, today: ledger.today }
}

const preview = (text: string, accountIds?: Array<string | null>) =>
  previewImport(depsFor(), ORG, { fileName: FILE, text, ...(accountIds === undefined ? {} : { accountIds }) })

/** The write step the browser sends for a statement of a preview: its own fields, the given lines, one account. */
function stepOf(stmt: PreviewStatement, operations: ImportOp[], accountId = 'a1'): ImportStepRequest {
  return {
    fileName: FILE,
    accountId,
    statement: { source: stmt.source, currency: stmt.currency, from: stmt.from, to: stmt.to, closingMinor: stmt.closing?.amountMinor ?? null, complete: stmt.issues.length === 0 && stmt.reconciliation === 0 },
    operations,
    last: false,
  }
}

const size = async (path: string) => (await db.collection(`organizations/${ORG}/${path}`).get()).size

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

describe('previewImport: suggested accounts', () => {
  it('suggests the account of an earlier import of the same source, while that account exists', async () => {
    await importStep(depsFor(), ORG, UID, { fileName: FILE, accountId: 'a1', statement: { source: SOURCE, currency: 'PLN', from: '2026-10-20', to: '2026-10-20', closingMinor: null, complete: true }, operations: [], last: false })
    const text = statementText(A, 'C261020PLN100,')
    expect((await preview(text)).statements[0].suggestedAccountId).toBe('a1')

    await db.doc(`organizations/${ORG}/accounts/a1`).delete()
    expect((await preview(text)).statements[0].suggestedAccountId).toBeNull()
  })

  it('suggests the account of an active bank account with the same IBAN, also when the bank stores it spaced and lower case', async () => {
    await seedBank(db, { iban: 'pl61 1090 1014 0000 0712 1981 2874' })
    const res = await preview(statementText(A, 'C261020PLN100,'))
    expect(res.statements[0]).toMatchObject({ source: SOURCE, suggestedAccountId: 'a1' })

    const other = await preview(statementText(A, 'C261020PLN100,', 'PL11111111111111111111111111'))
    expect(other.statements[0].suggestedAccountId).toBeNull()
  })
})

describe('previewImport: statuses of the chosen account', () => {
  it('marks each line seen, bank, new or refused, counts them, and reports the account balance', async () => {
    const text = statementText([...A, ...B, ...C], 'C261021PLN85,')
    // A bank-linked account (ba1 is linked to a1): an expense of 40,00 on 21.10 that the bank wrote without a reference.
    await seedBank(db)
    await createTransaction(depsFor().ledger, ORG, UID, parseTransactionInput({ clientId: 'manual-bank-1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 4_000, paymentDate: '2026-10-21' }), { accountRef: 'ba1' })
    // Line A was written by an earlier step of this file.
    const first = (await preview(text)).statements[0]
    await importStep(depsFor(), ORG, UID, stepOf(first, [first.operations[0]]))

    const res = await preview(text, ['a1'])
    const stmt = res.statements[0]
    expect(stmt.operations.map((o) => o.status)).toEqual(['seen', 'bank', 'new'])
    expect(stmt.chosen).toEqual({ accountId: 'a1', accountCurrency: 'PLN', balanceMinor: 6_000, counts: { new: 1, seen: 1, bank: 1, refused: 0 } })
  })

  it('one bank operation covers one line: of two identical lines against one bank operation, one is bank and the other new', async () => {
    await seedBank(db)
    await createTransaction(depsFor().ledger, ORG, UID, parseTransactionInput({ clientId: 'manual-bank-2', type: 'income', status: 'actual', accountId: 'a1', amountMinor: 10_000, paymentDate: '2026-10-20' }), { accountRef: 'ba1' })
    const same = [':61:261020C100,NTRFNONREF', ':86:Kawa']
    const res = await preview(statementText([...same, ...same], 'C261020PLN200,'), ['a1'])
    expect(res.statements[0].operations.map((o) => o.status)).toEqual(['bank', 'new'])
  })

  it('numbers identical lines of two statements of one account apart: a line written from one statement does not mark the other', async () => {
    const same = [':61:261020C100,NTRFNONREF', ':86:Kawa']
    const text = [statementText(same, 'C261020PLN100,'), statementText(same, 'C261020PLN100,', 'PL11111111111111111111111111')].join('\n')
    const first = (await preview(text)).statements[0]
    await importStep(depsFor(), ORG, UID, stepOf(first, [first.operations[0]]))

    const res = await preview(text, ['a1', 'a1'])
    expect(res.statements.map((s) => s.operations.map((o) => o.status))).toEqual([['seen'], ['new']])
  })

  it('refuses every line of a statement in another currency than the account', async () => {
    await seedAccount(db, ORG, 'a2', 'EUR', 0)
    const res = await preview(statementText([...A, ...B], 'C261021PLN60,'), ['a2'])
    expect(res.statements[0].operations.map((o) => o.status)).toEqual(['refused:currency_mismatch', 'refused:currency_mismatch'])
    expect(res.statements[0].chosen).toEqual({ accountId: 'a2', accountCurrency: 'EUR', balanceMinor: 0, counts: { new: 0, seen: 0, bank: 0, refused: 2 } })
  })

  it('gives a statement without a chosen account no chosen block and no statuses', async () => {
    const text = [statementText(A, 'C261020PLN100,'), statementText(C, 'C261021PLN25,', 'PL11111111111111111111111111')].join('\n')
    const res = await preview(text, ['a1', null])
    expect(res.statements).toHaveLength(2)
    expect(res.statements[0].chosen?.counts).toEqual({ new: 1, seen: 0, bank: 0, refused: 0 })
    expect(res.statements[1].chosen).toBeUndefined()
    expect(res.statements[1].operations[0]).not.toHaveProperty('status')
    expect(res.statements[1].source).toBe('PL11111111111111111111111111')
  })
})

describe('previewImport: refusals of the request', () => {
  it('a text without a statement is invalid_input in the file field', async () => {
    await expect(preview('this is not a statement')).rejects.toMatchObject({ code: 'invalid_input', field: 'file' })
  })

  it('more operations than MAX_IMPORT_OPS are too_many_operations', async () => {
    const lines = Array.from({ length: MAX_IMPORT_OPS + 1 }, (_, i) => `:61:261020C1,NTRFR${i}`)
    await expect(preview(statementText(lines, 'C261020PLN50,'))).rejects.toMatchObject({ code: 'too_many_operations' })
  })

  it('a text over MAX_IMPORT_BYTES is payload_too_large', async () => {
    await expect(preview('x'.repeat(MAX_IMPORT_BYTES + 1))).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('an unknown account is account_not_found', async () => {
    await expect(preview(statementText(A, 'C261020PLN100,'), ['nope'])).rejects.toMatchObject({ code: 'account_not_found' })
  })

  it('accountIds must have one entry per statement', async () => {
    await expect(preview(statementText(A, 'C261020PLN100,'), ['a1', 'a1'])).rejects.toMatchObject({ code: 'invalid_input', field: 'accountIds' })
  })
})

describe('previewImport: read only', () => {
  it('writes nothing: no import, no mark, no operation, no balance change', async () => {
    const text = statementText([...A, ...B, ...C], 'C261021PLN85,')
    const first = (await preview(text)).statements[0]
    await importStep(depsFor(), ORG, UID, stepOf(first, [first.operations[0]]))

    const before = { imports: await size('imports'), bankSeen: await size('bankSeen'), transactions: await size('transactions'), balance: await balanceOf(db, ORG, 'a1') }
    await preview(text)
    await preview(text, ['a1'])
    expect({ imports: await size('imports'), bankSeen: await size('bankSeen'), transactions: await size('transactions'), balance: await balanceOf(db, ORG, 'a1') }).toEqual(before)
  })
})
