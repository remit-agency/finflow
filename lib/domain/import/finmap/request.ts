import { nameKeyText, NAME_MAX as COUNTERPARTY_NAME_MAX } from '@/lib/domain/counterparties/normalize'
import { NAME_MAX as ENTITY_NAME_MAX } from '@/lib/domain/ledger/entity-input'
import { isMinor, MAX_MINOR } from '@/lib/domain/ledger/money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, type AccountType } from '@/lib/domain/ledger/types'
import { TAG_NAME_MAX } from '@/lib/domain/tags/types'
import { isId, type Parsed } from '../request'
import { normName } from './fold'
import type { CategoryRef } from './types'

/** The most entities one setup request names (S14b: the browser sends the whole file's names, the server matches them). */
export const SETUP_LIMITS = { accounts: 200, categories: 5000, counterparties: 5000, tags: 500 } as const
const FILE_NAME_MAX = 255

export interface FinmapSetupAccount {
  name: string
  type: AccountType
  currency: string
  /** The balance the user typed for an account; null when none was given. Fitted at finish, for new accounts only. */
  currentBalanceMinor: number | null
}

export interface FinmapSetupRequest {
  /** An applied Finmap import to continue (a retry); absent for a new run. */
  importId?: string
  fileName: string
  accounts: FinmapSetupAccount[]
  /** Parents first is not assumed: the server orders them. */
  categories: CategoryRef[]
  counterparties: string[]
  tags: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A name from the body: whitespace normalised, within `max`, and with a letter or digit (a name without one has no comparable key). */
function nameOf(v: unknown, max: number, field: string): Parsed<string> {
  const name = typeof v === 'string' ? normName(v) : null
  if (name === null || name.length > max || nameKeyText(name) === '') return { ok: false, field }
  return { ok: true, value: name }
}

/** A list of at most `max` items, each parsed by `item`; the first refusal is returned with its path. */
function listOf<T>(v: unknown, field: string, max: number, item: (x: unknown, at: string) => Parsed<T>): Parsed<T[]> {
  if (!Array.isArray(v) || v.length > max) return { ok: false, field }
  const out: T[] = []
  for (let i = 0; i < v.length; i++) {
    const r = item(v[i], `${field}[${i}]`)
    if (!r.ok) return r
    out.push(r.value)
  }
  return { ok: true, value: out }
}

function parseAccount(v: unknown, at: string): Parsed<FinmapSetupAccount> {
  if (!isRecord(v)) return { ok: false, field: at }
  const name = nameOf(v.name, ENTITY_NAME_MAX, `${at}.name`)
  if (!name.ok) return name
  const type = v.type
  if (!(ACCOUNT_TYPES as readonly unknown[]).includes(type)) return { ok: false, field: `${at}.type` }
  const currency = v.currency
  if (typeof currency !== 'string' || !(LEDGER_CURRENCIES as readonly unknown[]).includes(currency)) return { ok: false, field: `${at}.currency` }
  const balance = v.currentBalanceMinor
  if (balance !== null && (!isMinor(balance) || Math.abs(balance) > MAX_MINOR)) return { ok: false, field: `${at}.currentBalanceMinor` }
  return { ok: true, value: { name: name.value, type: type as AccountType, currency, currentBalanceMinor: balance } }
}

function parseCategory(v: unknown, at: string): Parsed<CategoryRef> {
  if (!isRecord(v)) return { ok: false, field: at }
  const type = v.type
  if (type !== 'income' && type !== 'expense') return { ok: false, field: `${at}.type` }
  const parent = nameOf(v.parent, ENTITY_NAME_MAX, `${at}.parent`)
  if (!parent.ok) return parent
  if (v.child === null) return { ok: true, value: { type, parent: parent.value, child: null } }
  const child = nameOf(v.child, ENTITY_NAME_MAX, `${at}.child`)
  if (!child.ok) return child
  return { ok: true, value: { type, parent: parent.value, child: child.value } }
}

/** The setup body (S14b step 4): what the file needs, by name. Names are whitespace-normalised here, once. */
export function parseFinmapSetup(body: unknown): Parsed<FinmapSetupRequest> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (body.importId !== undefined && !isId(body.importId)) return { ok: false, field: 'importId' }
  if (typeof body.fileName !== 'string' || body.fileName.trim() === '' || body.fileName.length > FILE_NAME_MAX) return { ok: false, field: 'fileName' }
  const accounts = listOf(body.accounts, 'accounts', SETUP_LIMITS.accounts, parseAccount)
  if (!accounts.ok) return accounts
  const categories = listOf(body.categories, 'categories', SETUP_LIMITS.categories, parseCategory)
  if (!categories.ok) return categories
  const counterparties = listOf(body.counterparties, 'counterparties', SETUP_LIMITS.counterparties, (x, at) => nameOf(x, COUNTERPARTY_NAME_MAX, at))
  if (!counterparties.ok) return counterparties
  const tags = listOf(body.tags, 'tags', SETUP_LIMITS.tags, (x, at) => nameOf(x, TAG_NAME_MAX, at))
  if (!tags.ok) return tags
  const value: FinmapSetupRequest = {
    fileName: body.fileName,
    accounts: accounts.value,
    categories: categories.value,
    counterparties: counterparties.value,
    tags: tags.value,
  }
  if (body.importId !== undefined) value.importId = body.importId
  return { ok: true, value }
}

/** The finish body (S14b step 5): the Finmap import whose balances are fitted. */
export function parseFinmapFinish(body: unknown): Parsed<{ importId: string }> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (!isId(body.importId)) return { ok: false, field: 'importId' }
  return { ok: true, value: { importId: body.importId } }
}
