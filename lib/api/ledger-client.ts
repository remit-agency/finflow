import { fullPatch, RESTORE_MARKER } from '@/lib/domain/ledger/input'
import { toMinor } from '@/lib/domain/ledger/money'
import { notifyLedgerChanged } from './ledger-events'
import type { Accrual, AccountType, TxStatus, TxType } from '@/lib/domain/ledger/types'

/** A failed call: the HTTP status and the short error code the server answered with. */
export class LedgerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    /** The whole JSON error body (`field`, `existingId`), when the server sent one. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'LedgerApiError'
  }
}

export interface TransactionDraft {
  type: TxType
  status?: TxStatus
  accountId: string
  /** In the currency of the account, 2 decimals. */
  amount: number
  toAccountId?: string
  toAmount?: number
  paymentDate: string
  accrual?: Accrual
  categoryId?: string
  counterpartyId?: string
  description?: string
  isRecurring: boolean
  projectId?: string
  tags: string[]
  fileUrls: string[]
}

export interface AccountDraft {
  name: string
  type: AccountType
  currency: string
  color: string
  /** Opening balance, 2 decimals. */
  opening: number
}

/** The request body for a draft (minor units, no undefined keys). */
export function draftToBody(d: TransactionDraft, clientId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: d.type,
    accountId: d.accountId,
    amountMinor: toMinor(d.amount),
    paymentDate: d.paymentDate,
    isRecurring: d.isRecurring,
    tags: d.tags,
    fileUrls: d.fileUrls,
  }
  if (clientId !== undefined) body.clientId = clientId
  if (d.status !== undefined) body.status = d.status
  if (d.toAccountId !== undefined) body.toAccountId = d.toAccountId
  if (d.toAmount !== undefined) body.toAmountMinor = toMinor(d.toAmount)
  if (d.accrual !== undefined) body.accrual = d.accrual
  if (d.categoryId !== undefined) body.categoryId = d.categoryId
  if (d.counterpartyId !== undefined) body.counterpartyId = d.counterpartyId
  if (d.description !== undefined) body.description = d.description
  if (d.projectId !== undefined) body.projectId = d.projectId
  return body
}

/** The PATCH body that makes the stored operation equal the draft: absent optional fields are cleared. */
export function draftToPatch(d: TransactionDraft): Record<string, unknown> {
  return fullPatch(draftToBody(d))
}

export async function readApiError(res: Response): Promise<LedgerApiError> {
  let code = 'unknown'
  let details: Record<string, unknown> | undefined
  try {
    const json = (await res.json()) as Record<string, unknown>
    if (typeof json.error === 'string') code = json.error
    details = json
  } catch {
    // Not JSON: keep 'unknown'.
  }
  return new LedgerApiError(res.status, code, details)
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await readApiError(res)
  return res.status === 204 ? null : res.json()
}

const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

/** `clientId` makes a retry or a double click create the operation once. */
export async function createTransaction(orgId: string, draft: TransactionDraft, clientId?: string): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/transactions`, draftToBody(draft, clientId))) as { transaction: { id: string } }
  notifyLedgerChanged()
  return out.transaction.id
}

/** `restore`: the write puts a previous state back (the undo), so the server may take back a tag archived since (S10t). */
export async function updateTransaction(orgId: string, txId: string, draft: TransactionDraft, opts: { restore?: boolean } = {}): Promise<void> {
  const query = opts.restore === true ? `?${RESTORE_MARKER}=1` : ''
  await call('PATCH', `${org(orgId)}/transactions/${encodeURIComponent(txId)}${query}`, draftToPatch(draft))
  notifyLedgerChanged()
}

export async function deleteTransaction(orgId: string, txId: string): Promise<void> {
  await call('DELETE', `${org(orgId)}/transactions/${encodeURIComponent(txId)}`)
  notifyLedgerChanged()
}

const accountBody = (d: Partial<AccountDraft>) => {
  const { opening, ...rest } = d
  return opening === undefined ? rest : { ...rest, openingMinor: toMinor(opening) }
}

export async function createAccount(orgId: string, draft: AccountDraft): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/accounts`, accountBody(draft))) as { account: { id: string } }
  return out.account.id
}

export async function updateAccount(orgId: string, accountId: string, patch: Partial<AccountDraft>): Promise<void> {
  await call('PATCH', `${org(orgId)}/accounts/${encodeURIComponent(accountId)}`, accountBody(patch))
}

export async function deleteAccount(orgId: string, accountId: string): Promise<void> {
  await call('DELETE', `${org(orgId)}/accounts/${encodeURIComponent(accountId)}`)
}

export async function updateOrganization(orgId: string, patch: { name?: string; currency?: string }): Promise<void> {
  await call('PATCH', org(orgId), patch)
}

export { call as apiCall }
