import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/orgs/[orgId]/transactions/[txId]/route'
import { journal } from '@/lib/server/journal'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/journal', () => ({ journal: { readOne: vi.fn(), readPage: vi.fn(), bulk: vi.fn() } }))

const TX = { id: 't1', type: 'income', status: 'actual', accountId: 'a1', amountMinor: 100 }

const call = (token: string | null, txId = 't1') =>
  GET(
    new Request(`http://localhost:3000/api/orgs/org-acme/transactions/${txId}`, {
      headers: { Origin: 'http://localhost:3000', ...(token ? { Cookie: `__session=${token}` } : {}) },
    }),
    { params: Promise.resolve({ orgId: 'org-acme', txId }) },
  )

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(journal.readOne).mockReset()
})

describe('GET /transactions/{txId}', () => {
  it('answers 401 without a session and 403 to a stranger, and reads nothing', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('token-mallory')).status).toBe(403)
    expect(journal.readOne).not.toHaveBeenCalled()
  })

  it.each(['token-alice', 'token-carol', 'token-dave'])('lets %s (owner, accountant, viewer) read it, uncached', async (token) => {
    vi.mocked(journal.readOne).mockResolvedValue(TX as never)
    const res = await call(token)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ transaction: TX })
    expect(journal.readOne).toHaveBeenCalledWith('org-acme', 't1')
  })

  it('answers 404 when the operation does not exist', async () => {
    vi.mocked(journal.readOne).mockResolvedValue(null)
    expect((await call('token-alice')).status).toBe(404)
  })

  it('answers 404 to a malformed id without reading', async () => {
    expect((await call('token-alice', 'a%2Fb')).status).toBe(404)
    expect(journal.readOne).not.toHaveBeenCalled()
  })
})
