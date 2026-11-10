import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { SERIES_SET, markChangeOf, rewriteDiffers, seriesSetDiffers, withSeries, type MarkChange } from '@/lib/domain/ledger/series'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { parseCandidate } from '@/lib/domain/transfers/pairs'
import { toUiTransaction } from '@/lib/firebase/ledger-map'

/** The ZUS occurrence of 15 November 2026 (a Sunday), planned for Monday the 16th, the amount an estimate. */
const plan: LedgerTransaction = {
  id: 'pl_ser1_2026-11-15', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 150_000, currency: 'PLN',
  paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: [], fileUrls: [],
  counterpartyId: 'system_zus', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true,
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

/** `next` as an edit builds it: the ledger's own fields come from the prior document, never from the request. */
function edited(change: Partial<LedgerTransaction>): LedgerTransaction {
  const next: LedgerTransaction = { ...plan, ...change }
  delete next.seriesId
  delete next.occurrence
  delete next.estimated
  delete next.manual
  return next
}

describe('the series fields of an operation (S11)', () => {
  it('round-trip; estimated and manual are stored only when true', () => {
    const doc = transactionToDoc(plan)
    expect(doc).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect('manual' in doc).toBe(false)
    expect(parseTransaction(plan.id, doc)).toEqual(plan)
    const plain: LedgerTransaction = { ...plan }
    delete plain.estimated
    expect('estimated' in transactionToDoc(plain)).toBe(false)
  })

  it.each([
    ['a series id that is not a document id', { seriesId: 'a/b' }],
    ['an occurrence that is not a day', { occurrence: '2026-11-31' }],
    ['a series id without its occurrence', { occurrence: undefined }],
    ['a flag that is not a boolean', { estimated: 'yes' }],
  ])('an operation with %s is unreadable', (_name, change) => {
    const doc: Record<string, unknown> = { ...transactionToDoc(plan), ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete doc[key]
    expect(parseTransaction(plan.id, doc)).toBeNull()
  })

  it('a flag without a series, or a series link on a transfer, is unreadable', () => {
    const free = edited({})
    expect(parseTransaction(plan.id, { ...transactionToDoc(free), manual: true })).toBeNull()
    const transfer: Record<string, unknown> = {
      ...transactionToDoc(free), type: 'transfer', toAccountId: 'cash', toAmountMinor: 150_000, toCurrency: 'PLN', seriesId: 'ser1', occurrence: '2026-11-15',
    }
    delete transfer.counterpartyId
    expect(parseTransaction(plan.id, transfer)).toBeNull()
  })

  it('a request can neither name a series nor use a plan id', () => {
    const body = { type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 100, paymentDate: '2026-11-16' }
    expect(code(() => parseTransactionInput({ ...body, seriesId: 'ser1' }))).toBe('invalid_input:seriesId')
    expect(code(() => parseTransactionInput({ ...body, occurrence: '2026-11-15' }))).toBe('invalid_input:occurrence')
    expect(code(() => parseTransactionInput({ ...body, estimated: true }))).toBe('invalid_input:estimated')
    expect(code(() => parseTransactionInput({ ...body, manual: true }))).toBe('invalid_input:manual')
    expect(code(() => parseTransactionInput({ ...body, clientId: 'pl_ser1_2026-11-15' }))).toBe('invalid_input:clientId')
    // The create route passes `internal`: then createTransaction decides by the occurrence's mark (lib/server/ledger/write.ts).
    expect(code(() => parseTransactionInput({ ...body, clientId: 'pl_ser1_2026-11-15' }, { internal: true }))).toBe('ok')
  })
})

describe('withSeries: an edit keeps the link and decides «змінено вручну»', () => {
  it('a new amount makes a planned occurrence manual and no longer an estimate', () => {
    const out = withSeries(edited({ amountMinor: 160_000 }), plan)
    expect(out).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', manual: true, amountMinor: 160_000 })
    expect(out.estimated).toBeUndefined()
  })

  it.each([
    ['the payment day', { paymentDate: '2026-11-20' }],
    ['the category', { categoryId: 'zus' }],
    ['the counterparty', { counterpartyId: undefined }],
    ['the comment', { description: 'grudzień' }],
    ['the account', { accountId: 'mono' }],
    ['the tags', { tags: ['t1'] }],
    ['the type', { type: 'income' as const }],
    ['the accrual', { accrual: { mode: 'period' as const, from: '2026-11-01', to: '2026-11-30' } }],
    ['the recurring flag', { isRecurring: true }],
  ])('a change of %s makes it manual and keeps the estimate (I2: every field the series sets)', (_name, change) => {
    expect(withSeries(edited(change), plan)).toMatchObject({ manual: true, estimated: true, seriesId: 'ser1' })
  })

  it('an edit of nothing the series sets (a file, a project) keeps it as it was', () => {
    expect(withSeries(edited({ fileUrls: ['f1'] }), plan)).toEqual({ ...plan, fileUrls: ['f1'] })
    expect(withSeries(edited({ projectId: 'p1' }), plan)).toEqual({ ...plan, projectId: 'p1' })
  })

  it('an occurrence of a series cannot become a transfer (C2): the link would make the transfer unreadable', () => {
    const toTransfer = edited({ type: 'transfer', toAccountId: 'cash', toAmountMinor: 150_000, toCurrency: 'PLN' })
    expect(code(() => withSeries(toTransfer, plan))).toBe('series_transfer:type')
    expect(code(() => withSeries({ ...toTransfer, status: 'actual' }, plan))).toBe('series_transfer:type')
  })

  it('marking it paid keeps the link and the flags; an operation without a series gets none', () => {
    const paid = withSeries(edited({ status: 'actual', paymentDate: '2026-11-10', amountMinor: 151_000 }), plan)
    expect(paid).toMatchObject({ status: 'actual', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(paid.manual).toBeUndefined()
    const free = edited({})
    expect(withSeries({ ...free, description: 'x' }, free)).toEqual({ ...free, description: 'x' })
  })
})

describe('the fields a series sets (I2): one list for the manual mark and for the rewrite', () => {
  it('a rewrite differs when a series field or the estimate flag differs, not for a project or a file', () => {
    expect(rewriteDiffers(plan, { ...plan, amountMinor: 1 })).toBe(true)
    expect(rewriteDiffers(plan, { ...plan, accrual: { mode: 'date', date: '2026-11-17' } })).toBe(true)
    expect(rewriteDiffers(plan, { ...plan, isRecurring: true })).toBe(true)
    expect(rewriteDiffers(plan, { ...plan, estimated: undefined })).toBe(true)
    expect(rewriteDiffers(plan, { ...plan, projectId: 'p1', fileUrls: ['f1'] })).toBe(false)
    expect(rewriteDiffers(plan, { ...plan, tags: [...plan.tags] })).toBe(false)
  })

  it('a field the series sets, once changed by a person, is the same list a rewrite compares', () => {
    for (const field of SERIES_SET) expect(seriesSetDiffers(plan, { ...plan, [field]: field === 'tags' ? ['t9'] : field === 'accrual' ? { mode: 'period', from: '2026-11-01', to: '2026-11-30' } : 'x' })).toBe(true)
  })
})

describe('markChangeOf: which occurrence mark a write moves', () => {
  const paid: LedgerTransaction = { ...plan, status: 'actual', paymentDate: '2026-11-10' }
  const cases: Array<[string, LedgerTransaction | null, LedgerTransaction | null, MarkChange | null]> = [
    ['a plan marked as paid', plan, paid, 'paid'],
    ['a paid one back to a plan', paid, plan, 'clear'],
    ['a plan deleted', plan, null, 'deleted'],
    ['a paid one deleted (the occurrence stays paid)', paid, null, null],
    ['a plan restored', null, plan, 'clear'],
    ['a paid one restored', null, paid, 'paid'],
    ['a plan edited', plan, { ...plan, amountMinor: 1, manual: true }, null],
  ]
  it.each(cases)('%s', (_name, prior, next, want) => {
    expect(markChangeOf(prior, next)).toBe(want)
  })

  it('an operation without a series moves no mark', () => {
    expect(markChangeOf(edited({}), null)).toBeNull()
  })
})

describe('a bank operation that paid a plan is tied to its series (S10b)', () => {
  const bankOp: LedgerTransaction = {
    id: `bk_${'a'.repeat(32)}`, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 150_000, currency: 'PLN',
    paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: [], fileUrls: [], bank: { accountRef: 'ba-mil' },
  }

  it('is no bank side and no transfer candidate', () => {
    expect(bankSideOf(bankOp)).toBe('out')
    expect(bankSideOf({ ...bankOp, seriesId: 'ser1' })).toBeNull()
    const candidate = parseCandidate(bankOp.id, { ...transactionToDoc(bankOp), seriesId: 'ser1' }, '1.000000001')
    expect(candidate?.seriesId).toBe('ser1')
    expect(candidate === null ? 'none' : bankSideOf(candidate)).toBeNull()
  })
})

describe('the UI operation carries the series fields', () => {
  it('maps them, the flags only when true', () => {
    const ui = toUiTransaction('org1', plan)
    expect(ui).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(ui.manual).toBeUndefined()
  })
})
