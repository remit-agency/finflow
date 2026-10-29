import { isDay } from '@/lib/domain/ledger/days'
import { asRecord, bad, isId, onlyKeys } from '@/lib/domain/ledger/guards'
import { MIN_DAY } from '@/lib/domain/ledger/input'

export interface LinkRequest {
  connectionId: string
  ebAccountUid: string
  mode: 'create' | 'existing'
  accountId?: string
  name?: string
  importFrom: string
}

/** Validates the body of POST /api/orgs/{orgId}/bank/accounts. Throws `LedgerError('invalid_input', field)`-shaped errors via `bad`. */
export function parseLinkRequest(body: unknown): LinkRequest {
  const r = asRecord(body)
  onlyKeys(r, ['connectionId', 'ebAccountUid', 'mode', 'accountId', 'name', 'importFrom'])
  if (!isId(r.connectionId)) bad('connectionId')
  if (typeof r.ebAccountUid !== 'string' || r.ebAccountUid.length < 1 || r.ebAccountUid.length > 200) bad('ebAccountUid')
  if (r.mode !== 'create' && r.mode !== 'existing') bad('mode')
  if (!isDay(r.importFrom) || r.importFrom < MIN_DAY) bad('importFrom')
  let accountId: string | undefined
  if (r.mode === 'existing') {
    if (!isId(r.accountId)) bad('accountId')
    accountId = r.accountId
  } else if (r.accountId !== undefined) {
    bad('accountId')
  }
  let name: string | undefined
  if (r.name !== undefined) {
    if (typeof r.name !== 'string') bad('name')
    const text = r.name.trim()
    if (text.length > 120) bad('name')
    if (text.length > 0) name = text
  }
  return { connectionId: r.connectionId, ebAccountUid: r.ebAccountUid, mode: r.mode, accountId, name, importFrom: r.importFrom }
}
