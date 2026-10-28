import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreTransaction, revertTransaction } from '@/lib/api/transaction-undo'
import type { Transaction } from '@/types'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const stored: Transaction = {
  id: 'AbCdEfGh1234567890Zz',
  orgId: 'o1',
  accountId: 'a1',
  type: 'expense',
  status: 'actual',
  amount: 120.5,
  currency: 'PLN',
  categoryId: 'c1',
  counterpartyId: 'cp1',
  date: new Date('2026-10-20T00:00:00Z'),
  accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
  description: 'Czynsz',
  isRecurring: false,
  tags: ['q4'],
  fileUrls: [],
}

describe('restoreTransaction', () => {
  it('creates the operation again under its own id, with everything it had', async () => {
    fetchMock.mockResolvedValue(json(201, { transaction: { id: stored.id } }))
    vi.stubGlobal('fetch', fetchMock)

    await restoreTransaction('o1', stored)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/orgs/o1/transactions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: stored.id,
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amountMinor: 12050,
      paymentDate: '2026-10-20',
      isRecurring: false,
      tags: ['q4'],
      fileUrls: [],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
      categoryId: 'c1',
      counterpartyId: 'cp1',
      description: 'Czynsz',
    })
  })
})

describe('revertTransaction', () => {
  it('writes the stored operation back as a full replace', async () => {
    fetchMock.mockResolvedValue(json(200, { transaction: { id: stored.id } }))
    vi.stubGlobal('fetch', fetchMock)

    await revertTransaction('o1', stored)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/orgs/o1/transactions/${stored.id}`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ amountMinor: 12050, categoryId: 'c1', counterpartyId: 'cp1', description: 'Czynsz' })
    // absent optional fields are sent as null so the replace clears them
    expect(body.projectId).toBeNull()
  })

  it('fails with the API error when the server refuses', async () => {
    fetchMock.mockResolvedValue(json(422, { error: 'counterparty_archived', field: 'counterpartyId' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(revertTransaction('o1', stored)).rejects.toMatchObject({ status: 422, code: 'counterparty_archived' })
  })
})
