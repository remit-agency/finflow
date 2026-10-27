import type { Counterparty, VatStatus } from '@/lib/domain/counterparties/types'
import { apiCall, LedgerApiError } from './ledger-client'

export interface CounterpartyDraft {
  name: string
  nip?: string
  /** Account numbers as typed or normalised; the server normalises them. */
  ibans: string[]
  address?: string
}

export interface CounterpartyPatchDraft {
  name?: string
  /** `null` clears it. */
  nip?: string | null
  ibans?: string[]
  /** `null` clears it. */
  address?: string | null
  archived?: boolean
}

export interface LookupResult {
  found: boolean
  name?: string
  address?: string
  vatStatus?: VatStatus
  ibans: string[]
  /** The Warsaw day the white list was asked. */
  checkedOn: string
}

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/counterparties`

export async function createCounterparty(orgId: string, draft: CounterpartyDraft): Promise<Counterparty> {
  const body: Record<string, unknown> = { name: draft.name, ibans: draft.ibans }
  if (draft.nip !== undefined) body.nip = draft.nip
  if (draft.address !== undefined) body.address = draft.address
  const out = (await apiCall('POST', base(orgId), body)) as { counterparty: Counterparty }
  return out.counterparty
}

export async function updateCounterparty(orgId: string, id: string, patch: CounterpartyPatchDraft): Promise<Counterparty> {
  const out = (await apiCall('PATCH', `${base(orgId)}/${encodeURIComponent(id)}`, patch)) as { counterparty: Counterparty }
  return out.counterparty
}

/** What the MF white list says about a NIP (nothing is saved). Counts against the caller's lookup limit. */
export async function lookupNip(orgId: string, nip: string): Promise<LookupResult> {
  return (await apiCall('GET', `${base(orgId)}/lookup?nip=${encodeURIComponent(nip)}`)) as LookupResult
}

/** The field and the counterparty behind a `duplicate` answer, or null for any other error. */
export function duplicateOf(e: unknown): { field: 'nip' | 'name'; existingId: string | undefined } | null {
  if (!(e instanceof LedgerApiError) || e.code !== 'duplicate') return null
  const field = e.details?.field
  if (field !== 'nip' && field !== 'name') return null
  const existingId = e.details?.existingId
  return { field, existingId: typeof existingId === 'string' ? existingId : undefined }
}
