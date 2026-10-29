// The bank documents the server writes (lib/server/banking/link.ts), seeded as admin for the specs that need a linked
// bank and the fake bank (tests/e2e/helpers/eb-stub.mjs).
import type { APIRequestContext } from '@playwright/test'
import { seedDoc, type SeedFields } from './emulator-firestore'
import { addDays } from '../../../lib/domain/ledger/days'
import { todayDay } from '../../../lib/utils/today'

/** The session id the fake bank answers for. */
export const SESSION = 'e2e-session'
const OWNER_UID = 'e2e-owner'

/** Noon UTC is inside the same Warsaw calendar day, so the Warsaw day of this instant is exactly `day`. */
const instantOnDay = (day: string): string => `${day}T12:00:00.000Z`
export const dayFromToday = (n: number): string => addDays(todayDay(), n)

export function connectionFields(orgId: string, validUntilDay: string, status: 'active' | 'expired' = 'active'): SeedFields {
  return {
    orgId,
    sessionId: SESSION,
    institutionName: 'Fake Bank',
    institutionCountry: 'PL',
    psuType: 'business',
    connectedAt: new Date().toISOString(),
    validUntil: instantOnDay(validUntilDay),
    status,
    connectedBy: OWNER_UID,
  }
}

export async function seedConnection(request: APIRequestContext, orgId: string, validUntilDay: string, status: 'active' | 'expired' = 'active') {
  await seedDoc(request, `organizations/${orgId}/bankConnections`, SESSION, connectionFields(orgId, validUntilDay, status))
}

/** A linked bank account in the shape link.ts stores it (lastSyncAt null: the next page load syncs it). */
export async function seedLinkedBankAccount(request: APIRequestContext, orgId: string, accountId: string): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/bankAccounts`, 'bank-acc-1', {
    orgId,
    connectionId: SESSION,
    ebAccountUid: 'e2e-acc-1',
    identificationHashes: ['e2e-hash-1'],
    iban: 'PL61109010140000071219812874',
    currency: 'PLN',
    accountId,
    importFrom: dayFromToday(-90),
    status: 'active',
    lastSyncAt: null,
    syncedThrough: null,
    cursor: null,
    syncLock: null,
    bankBalance: null,
    firstSyncDone: false,
  })
}
