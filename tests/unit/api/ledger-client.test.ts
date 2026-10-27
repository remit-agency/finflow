import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LedgerApiError,
  createTransaction,
  deleteTransaction,
  draftToBody,
  draftToPatch,
  updateAccount,
  type TransactionDraft,
} from '@/lib/api/ledger-client'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const draft: TransactionDraft = {
  type: 'expense',
  accountId: 'a1',
  amount: 1234.6,
  paymentDate: '2026-10-20',
  isRecurring: false,
  tags: [],
  fileUrls: [],
}

describe('draftToBody', () => {
  it('converts the amount to minor units and omits undefined fields', () => {
    const body = draftToBody(draft)
    expect(body.amountMinor).toBe(123460)
    expect(body.paymentDate).toBe('2026-10-20')
    for (const key of ['clientId', 'status', 'toAccountId', 'toAmountMinor', 'accrual', 'categoryId', 'description']) {
      expect(key in body).toBe(false)
    }
  })

  it('includes the client id and converts the destination amount', () => {
    const body = draftToBody({ ...draft, type: 'transfer', toAccountId: 'a2', toAmount: 10.5 }, 'client-12345678')
    expect(body.clientId).toBe('client-12345678')
    expect(body.toAccountId).toBe('a2')
    expect(body.toAmountMinor).toBe(1050)
  })
})

describe('draftToPatch', () => {
  it('clears the optional fields the draft does not have', () => {
    const patch = draftToPatch(draft)
    expect(patch.categoryId).toBeNull()
    expect(patch.accrual).toBeNull()
    expect(patch.description).toBeNull()
    expect(patch.toAccountId).toBeNull()
    expect(patch.amountMinor).toBe(123460)
  })
})

describe('createTransaction', () => {
  it('posts JSON to the encoded organization path and returns the new id', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(201, { transaction: { id: 'tx9' } }))

    await expect(createTransaction('o 1', draft, 'client-12345678')).resolves.toBe('tx9')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/orgs/o%201/transactions')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toMatchObject({ clientId: 'client-12345678', amountMinor: 123460 })
  })

  it('rejects with the status and the server error code', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(409, { error: 'ledger_busy' }))

    const err = await createTransaction('o1', draft).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LedgerApiError)
    expect((err as LedgerApiError).status).toBe(409)
    expect((err as LedgerApiError).code).toBe('ledger_busy')
  })

  it('uses the code "unknown" when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 502 }))

    const err = await createTransaction('o1', draft).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LedgerApiError)
    expect((err as LedgerApiError).status).toBe(502)
    expect((err as LedgerApiError).code).toBe('unknown')
  })
})

describe('deleteTransaction', () => {
  it('resolves on 204 without reading a body', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteTransaction('o1', 'tx 1')).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/orgs/o1/transactions/tx%201')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })
})

describe('updateAccount', () => {
  it('sends the opening balance in minor units', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(200, { account: { id: 'a1' } }))

    await updateAccount('o1', 'a1', { opening: 12.5 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/orgs/o1/accounts/a1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ openingMinor: 1250 })
  })
})
