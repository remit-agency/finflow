import { describe, expect, it } from 'vitest'
import { draftToPatch } from '@/lib/api/ledger-client'
import {
  buildCreateDraft,
  buildEditDraft,
  categoryAfterTypeChange,
  type FormOwnedDraft,
} from '@/lib/api/transaction-draft'
import type { Transaction } from '@/types'

const stored: Transaction = {
  id: 'tx1',
  orgId: 'org1',
  accountId: 'acc1',
  type: 'income',
  status: 'actual',
  amount: 100,
  currency: 'PLN',
  categoryId: 'cat-sales',
  counterpartyId: 'cp1',
  date: new Date('2026-10-05T00:00:00.000Z'),
  accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
  description: 'Subscription',
  isRecurring: false,
  projectId: 'proj1',
  tags: ['q4', 'retainer'],
  fileUrls: ['https://files.example/invoice.pdf'],
}

/** What the form reports when the user changed only the amount. */
const onlyAmountChanged: FormOwnedDraft = {
  type: 'income',
  accountId: 'acc1',
  amount: 250,
  paymentDate: '2026-10-05',
  isRecurring: false,
  categoryId: 'cat-sales',
  description: 'Subscription',
}

describe('buildEditDraft', () => {
  it('keeps the fields the form does not own when only the amount changes', () => {
    const draft = buildEditDraft(stored, onlyAmountChanged)
    expect(draft.amount).toBe(250)
    expect(draft.categoryId).toBe('cat-sales')
    expect(draft.counterpartyId).toBe('cp1')
    expect(draft.projectId).toBe('proj1')
    expect(draft.tags).toEqual(['q4', 'retainer'])
    expect(draft.fileUrls).toEqual(['https://files.example/invoice.pdf'])
    expect(draft.accrual).toEqual({ mode: 'period', from: '2026-10-01', to: '2026-12-31' })
  })

  it('clears nothing but the amount in the PATCH that is sent', () => {
    const patch = draftToPatch(buildEditDraft(stored, onlyAmountChanged))
    expect(patch).toMatchObject({
      amountMinor: 25000,
      categoryId: 'cat-sales',
      counterpartyId: 'cp1',
      projectId: 'proj1',
      tags: ['q4', 'retainer'],
      fileUrls: ['https://files.example/invoice.pdf'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    // Only the fields the form owns may be null (cleared), and they are all set here.
    expect(Object.entries(patch).filter(([, v]) => v === null).map(([k]) => k).sort()).toEqual([
      'toAccountId',
      'toAmountMinor',
    ])
  })

  it('drops an accrual that only followed the payment date, so it follows the new date', () => {
    const followed: Transaction = { ...stored, accrual: { mode: 'date', date: '2026-10-05' } }
    const draft = buildEditDraft(followed, { ...onlyAmountChanged, paymentDate: '2026-10-09' })
    expect(draft.accrual).toBeUndefined()
    expect(draftToPatch(draft).accrual).toBeNull()
  })

  it('keeps a single-date accrual that differs from the payment date', () => {
    const own: Transaction = { ...stored, accrual: { mode: 'date', date: '2026-09-30' } }
    expect(buildEditDraft(own, onlyAmountChanged).accrual).toEqual({ mode: 'date', date: '2026-09-30' })
  })

  it('lets the form clear what it owns (category, description)', () => {
    const cleared: FormOwnedDraft = { ...onlyAmountChanged, categoryId: undefined, description: undefined }
    const draft = buildEditDraft(stored, cleared)
    expect(draft.categoryId).toBeUndefined()
    const patch = draftToPatch(draft)
    expect(patch.categoryId).toBeNull()
    expect(patch.description).toBeNull()
  })

  it('does not carry a counterparty or an accrual into a transfer, which the server refuses', () => {
    const transfer: FormOwnedDraft = {
      type: 'transfer',
      accountId: 'acc1',
      toAccountId: 'acc2',
      amount: 250,
      paymentDate: '2026-10-05',
      isRecurring: false,
    }
    const draft = buildEditDraft(stored, transfer)
    expect(draft.counterpartyId).toBeUndefined()
    expect(draft.accrual).toBeUndefined()
    expect(draft.categoryId).toBeUndefined()
    expect(draft.projectId).toBe('proj1')
    expect(draft.tags).toEqual(['q4', 'retainer'])
  })

  it('does not mutate the stored operation through the carried arrays', () => {
    const draft = buildEditDraft(stored, onlyAmountChanged)
    draft.tags.push('x')
    expect(stored.tags).toEqual(['q4', 'retainer'])
  })
})

describe('buildCreateDraft', () => {
  it('starts a new operation with no tags or files', () => {
    expect(buildCreateDraft(onlyAmountChanged)).toMatchObject({ amount: 250, tags: [], fileUrls: [] })
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
