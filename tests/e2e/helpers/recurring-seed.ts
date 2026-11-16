// Series and planned operations written through the real routes for the S11 specs (the signed-in page's request context
// carries the session cookie), so they get their plans, marks and audit entries like the app's own.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { readDoc } from './emulator-firestore'

const ORIGIN = { Origin: 'http://localhost:3000' }

/** The stored balance of an account in minor units, read as admin (the S11 and S13 specs check it after a payment). */
export async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A series through `POST /recurring`; returns its id. */
export async function seedSeries(page: Page, orgId: string, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post(`/api/orgs/${orgId}/recurring`, { headers: ORIGIN, data: body })
  expect(res.status(), 'series').toBe(201)
  return ((await res.json()) as { series: { id: string } }).series.id
}

/** A planned operation a person typed (no series), on any day. */
export async function seedPlanned(
  page: Page,
  orgId: string,
  op: { type: 'income' | 'expense'; accountId: string; amountMinor: number; paymentDate: string; description: string },
): Promise<void> {
  const res = await page.request.post(`/api/orgs/${orgId}/transactions`, { headers: ORIGIN, data: { ...op, status: 'planned' } })
  expect(res.status(), 'planned operation').toBe(201)
}

/** ISO weekday (1 Monday ... 7 Sunday) of a `YYYY-MM-DD` day. */
export function isoWeekdayOf(day: string): number {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
}
