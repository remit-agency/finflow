import { describe, expect, it } from 'vitest'
import { draftToPatch } from '@/lib/api/ledger-client'
import {
  buildCreateDraft,
  buildEditDraft,
  categoryAfterTypeChange,
  stateToDraft,
  transactionToDraft,
  type FormOwnedDraft,
} from '@/lib/api/transaction-draft'
import { initialFormState, type FormState } from '@/lib/domain/transaction-form/state'
import type { Transaction } from '@/types'

const stored = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx1',
  orgId: 'org1',
  accountId: 'a1',
  type: 'expense',
  status: 'actual',
  amount: 120.5,
  currency: 'PLN',
  date: new Date('2026-10-20T00:00:00.000Z'),
  accrual: { mode: 'date', date: '2026-10-20' },
  isRecurring: false,
  tags: [],
  fileUrls: [],
  ...over,
})

/** What the form reports; every field it can carry is optional here. */
const form = (over: Partial<FormOwnedDraft> = {}): FormOwnedDraft => ({
  type: 'expense',
  accountId: 'a1',
  amount: 120.5,
  paymentDate: '2026-10-20',
  isRecurring: false,
  tags: [],
  ...over,
})

describe('buildEditDraft', () => {
  it('carries only what the form does not show: project and files; the tags come from the form (S10t)', () => {
    const tx = stored({ projectId: 'p1', tags: ['q4'], fileUrls: ['https://x/f.pdf'], counterpartyId: 'c-old' })
    const draft = buildEditDraft(tx, form({ amount: 99, tags: ['vat'] }))
    expect(draft).toMatchObject({ amount: 99, projectId: 'p1', tags: ['vat'], fileUrls: ['https://x/f.pdf'] })
    // the counterparty and accrual now come from the form, never from the stored operation
    expect(draft.counterpartyId).toBeUndefined()
    expect(draft.accrual).toBeUndefined()
  })

  it('sends the counterparty, accrual and status the form holds', () => {
    const draft = buildEditDraft(
      stored(),
      form({ counterpartyId: 'c1', accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' }, status: 'planned' }),
    )
    expect(draft).toMatchObject({
      counterpartyId: 'c1',
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
      status: 'planned',
    })
  })

  it('lets the form clear what it owns (category, description, counterparty, tags)', () => {
    const tx = stored({ categoryId: 'c1', description: 'x', counterpartyId: 'cp1', tags: ['q4'] })
    const patch = draftToPatch(buildEditDraft(tx, form({})))
    expect(patch).toMatchObject({ categoryId: null, description: null, counterpartyId: null, tags: [] })
  })

  it('does not mutate the stored operation through the carried files', () => {
    const tx = stored({ fileUrls: ['u'] })
    const draft = buildEditDraft(tx, form({}))
    draft.fileUrls.push('v')
    expect(tx.fileUrls).toEqual(['u'])
  })
})

describe('buildCreateDraft', () => {
  it('starts a new operation with the tags the form chose and no files', () => {
    expect(buildCreateDraft(form({ amount: 250, tags: ['vat'] }))).toMatchObject({ amount: 250, tags: ['vat'], fileUrls: [] })
  })
})

describe('categoryAfterTypeChange', () => {
  it('clears the category when the type changes from income to expense', () => {
    expect(categoryAfterTypeChange('cat-sales', 'income', 'expense')).toBe('')
  })

  it('keeps the category when the type is the same (and on mount, where nothing changed)', () => {
    expect(categoryAfterTypeChange('cat-sales', 'income', 'income')).toBe('cat-sales')
  })
})

describe('stateToDraft', () => {
  const state = (over: Partial<FormState> = {}): FormState => ({
    ...initialFormState({ defaultType: 'expense', defaultAccountId: 'a1', today: '2026-10-28', formatAmount: String }),
    amount: '1 234,50',
    ...over,
  })

  it('an expense: parsed amount, category, counterparty, trimmed description, no tags', () => {
    expect(
      stateToDraft(state({ categoryId: 'c1', counterpartyId: 'cp1', description: '  Czynsz ' }), {
        today: '2026-10-28',
        crossCurrency: false,
      }),
    ).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amount: 1234.5,
      paymentDate: '2026-10-28',
      isRecurring: false,
      tags: [],
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
    })
  })

  it('sends the chosen tags in their order, for a transfer too, without sharing the array', () => {
    const tagIds = ['vat', 'q4']
    const draft = stateToDraft(state({ type: 'transfer', toAccountId: 'a2', tagIds }), { today: '2026-10-28', crossCurrency: false })
    expect(draft.tags).toEqual(['vat', 'q4'])
    draft.tags.push('x')
    expect(tagIds).toEqual(['vat', 'q4'])
  })

  it('a future payment date is sent as planned, whatever was chosen', () => {
    const draft = stateToDraft(state({ paymentDate: '2026-11-15' }), { today: '2026-10-28', crossCurrency: false })
    expect(draft.status).toBe('planned')
  })

  it('an own accrual is sent only when the switch is on', () => {
    const on = { on: true, mode: 'period' as const, date: null, from: '2026-10-01', to: '2026-12-31' }
    expect(stateToDraft(state({ accrual: on }), { today: '2026-10-28', crossCurrency: false }).accrual).toEqual({
      mode: 'period',
      from: '2026-10-01',
      to: '2026-12-31',
    })
    expect(stateToDraft(state(), { today: '2026-10-28', crossCurrency: false }).accrual).toBeUndefined()
  })

  it('a transfer sends the target account, the second amount only across currencies, and no category, counterparty or accrual', () => {
    const base = state({
      type: 'transfer',
      toAccountId: 'a2',
      toAmount: '100',
      categoryId: 'c1',
      counterpartyId: 'cp1',
      accrual: { on: true, mode: 'date', date: '2026-10-01', from: '', to: '' },
    })
    const same = stateToDraft(base, { today: '2026-10-28', crossCurrency: false })
    expect(same).toMatchObject({ type: 'transfer', toAccountId: 'a2' })
    for (const key of ['toAmount', 'categoryId', 'counterpartyId', 'accrual']) expect(key in same).toBe(false)
    expect(stateToDraft(base, { today: '2026-10-28', crossCurrency: true }).toAmount).toBe(100)
  })
})

describe('an unchanged edit', () => {
  // Saving the form without touching anything must send exactly what undo would restore: the form-owned fields (tags
  // included) go through the state and back, the rest (project, files) is carried from the stored operation on both sides.
  const options = { today: '2026-10-28', crossCurrency: false }
  const unchanged = (tx: Transaction) =>
    buildEditDraft(
      tx,
      stateToDraft(
        initialFormState({ transaction: tx, defaultType: 'expense', defaultAccountId: 'a1', today: options.today, formatAmount: String }),
        options,
      ),
    )

  it('an expense with counterparty, period accrual, category, description and tags round-trips', () => {
    const tx = stored({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      projectId: 'p1',
      tags: ['q4', 'vat'],
      fileUrls: ['https://x/f.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    expect(unchanged(tx)).toEqual(transactionToDraft(tx))
  })

  it('a planned expense round-trips', () => {
    const tx = stored({ status: 'planned', date: new Date('2026-11-15T00:00:00.000Z'), accrual: { mode: 'date', date: '2026-11-15' } })
    expect(unchanged(tx)).toEqual(transactionToDraft(tx))
  })
})

describe('transactionToDraft', () => {
  it('reproduces a stored expense in full, so that a create or a full replace restores it', () => {
    const tx = stored({
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      projectId: 'p1',
      tags: ['q4'],
      fileUrls: ['https://x/f.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    expect(transactionToDraft(tx)).toEqual({
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amount: 120.5,
      paymentDate: '2026-10-20',
      isRecurring: false,
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
      projectId: 'p1',
      tags: ['q4'],
      fileUrls: ['https://x/f.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
  })

  it('leaves out an accrual that only followed the payment date, so it follows again', () => {
    expect(transactionToDraft(stored()).accrual).toBeUndefined()
  })

  it('a transfer carries its target, the second amount only across currencies, and no accrual or counterparty', () => {
    const cross = transactionToDraft(
      stored({ type: 'transfer', toAccountId: 'a2', toAmount: 28, toCurrency: 'EUR', accrual: { mode: 'date', date: '2026-10-01' } }),
    )
    expect(cross).toMatchObject({ toAccountId: 'a2', toAmount: 28 })
    expect('accrual' in cross).toBe(false)
    const same = transactionToDraft(stored({ type: 'transfer', toAccountId: 'a2', toAmount: 120.5, toCurrency: 'PLN' }))
    expect('toAmount' in same).toBe(false)
  })

  it('does not share the arrays with the stored operation', () => {
    const tx = stored({ tags: ['a'] })
    transactionToDraft(tx).tags.push('b')
    expect(tx.tags).toEqual(['a'])
  })
})
