// Operations written through the real create route for the S12 specs (the signed-in page's request context carries the
// session cookie), so the ledger keeps the balances, the rollups and `excluded` as the app's own writes do: the server
// reports read the rollups, which `seedLedgerOperation` (an admin write without them) does not produce.
import { expect, type Page } from '@playwright/test'

const ORIGIN = { Origin: 'http://localhost:3000' }

export interface ApiOperation {
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  amountMinor: number
  paymentDate: string
  toAccountId?: string
  toAmountMinor?: number
  categoryId?: string
  tags?: string[]
  description?: string
  accrual?: { mode: 'date'; date: string } | { mode: 'period'; from: string; to: string }
}

export async function postOperation(page: Page, orgId: string, op: ApiOperation): Promise<void> {
  const res = await page.request.post(`/api/orgs/${orgId}/transactions`, { headers: ORIGIN, data: op })
  expect(res.status(), `operation «${op.description ?? op.type}»: ${await res.text()}`).toBe(201)
}
