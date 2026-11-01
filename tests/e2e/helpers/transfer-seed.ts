// Bank operations written by the real ledger for the S10b specs: the `bankSeen` mark first, in the shape the sync stores it
// (lib/server/banking/sync.ts), then the create route under the bank id, which takes the bank block from that mark. The
// operations get rollups and audit entries like imported ones, without the fake bank.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { seedDoc } from './emulator-firestore'

const ORIGIN = { Origin: 'http://localhost:3000' }

export interface SeedBankOperation {
  /** Letters and digits; the operation id is `bk_<key>`. */
  key: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  paymentDate: string
  /** The bank's text, also the comment of the operation (as the import makes it). */
  remittance: string
}

/** Returns the id of the operation. `page` must be signed in (its request context carries the session cookie). */
export async function seedBankOperation(page: Page, request: APIRequestContext, orgId: string, op: SeedBankOperation): Promise<string> {
  const bank = { accountRef: `ba-${op.accountId}`, entryReference: `ref-${op.key}`, counterpartyName: 'Własne konto', remittance: op.remittance }
  await seedDoc(request, `organizations/${orgId}/bankSeen`, op.key, {
    txId: `bk_${op.key}`,
    at: new Date().toISOString(),
    bank,
    snapshot: { type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate },
  })
  const res = await page.request.post(`/api/orgs/${orgId}/transactions`, {
    headers: ORIGIN,
    data: { clientId: `bk_${op.key}`, type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate, description: op.remittance },
  })
  expect(res.status(), `bank operation ${op.key}`).toBe(201)
  return `bk_${op.key}`
}
