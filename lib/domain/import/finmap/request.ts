import { nameKeyText, NAME_MAX as COUNTERPARTY_NAME_MAX } from '@/lib/domain/counterparties/normalize'
import { NAME_MAX as ENTITY_NAME_MAX } from '@/lib/domain/ledger/entity-input'
import { isDay } from '@/lib/domain/ledger/days'
import { isMinor, MAX_MINOR } from '@/lib/domain/ledger/money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, type AccountType } from '@/lib/domain/ledger/types'
import { MAX_TX_TAGS, TAG_NAME_MAX } from '@/lib/domain/tags/types'
import { isId, type Parsed } from '../request'
import { normName } from './fold'
import { FINMAP_BATCH_OPS, type CategoryRef, type OpKind } from './types'

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

/** The most characters a name may have, by what it names: the caps the ledger enforces, shared by the parser and the planner (S14b). */
export const NAME_LIMITS = {
  account: ENTITY_NAME_MAX,
  category: ENTITY_NAME_MAX,
  counterparty: COUNTERPARTY_NAME_MAX,
  tag: TAG_NAME_MAX,
} as const

/** Whether a normalised name fits `max` and has a letter or digit (a name without one has no comparable key). */
export function nameFits(name: string, max: number): boolean {
  return name.length <= max && nameKeyText(name) !== ''
}

/** A name from the body: whitespace normalised, and `nameFits`. */
function nameOf(v: unknown, max: number, field: string): Parsed<string> {
  const name = typeof v === 'string' ? normName(v) : null
  if (name === null || !nameFits(name, max)) return { ok: false, field }
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

/** Duplicate-check keys per request (S14b): one lookup per operation of a file page. */
export const CHECK_LIMIT = 500
/** Identity strings one operation key carries (`finmapIdentity` gives 8; a transfer joins two of them with '+': 17), and the longest of them. */
const IDENTITY_MAX = 17
const IDENTITY_TEXT_MAX = 400
const ORDINAL_MAX = 100_000
const DESCRIPTION_MAX = 500

/** One operation of a batch, by ids (the client resolved them with the setup step). Consistency is checked here. */
export interface BatchOp {
  kind: OpKind
  status: 'actual' | 'planned'
  day: string
  amountMinor: number
  accountId: string
  toAccountId: string | null
  /** The amount that arrives (a transfer between accounts of different currencies); null otherwise or when it is the same. */
  toAmountMinor: number | null
  categoryId: string | null
  counterpartyId: string | null
  tagIds: string[]
  description: string | null
  accrual: { from: string; to: string } | null
  identity: string[]
  ordinal: number
}

export interface FinmapBatchRequest {
  importId: string
  operations: BatchOp[]
}

/** What a duplicate check needs of one operation: its key (accounts, identity, ordinal). */
export interface FinmapCheckOp {
  accountId: string
  toAccountId: string | null
  identity: string[]
  ordinal: number
}

export interface FinmapCheckRequest {
  operations: FinmapCheckOp[]
}

const isMinorAmount = (v: unknown): v is number => isMinor(v) && v > 0 && v <= MAX_MINOR

/** The identity strings of a key: at most IDENTITY_MAX, each a string of at most 400 characters. */
function identityOf(v: unknown, at: string): Parsed<string[]> {
  if (!Array.isArray(v) || v.length > IDENTITY_MAX) return { ok: false, field: at }
  for (const s of v) if (typeof s !== 'string' || s.length > IDENTITY_TEXT_MAX) return { ok: false, field: at }
  return { ok: true, value: [...v] }
}

function ordinalOf(v: unknown, at: string): Parsed<number> {
  return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= ORDINAL_MAX ? { ok: true, value: v as number } : { ok: false, field: at }
}

/** An optional id: null, or a safe id. */
function nullableId(v: unknown, at: string): Parsed<string | null> {
  if (v === null) return { ok: true, value: null }
  return isId(v) ? { ok: true, value: v } : { ok: false, field: at }
}

/** One batch operation. A transfer has a target account other than its own and no category, counterparty or accrual; an income or an expense has neither a target nor a received amount. */
function parseBatchOp(v: unknown, at: string): Parsed<BatchOp> {
  if (!isRecord(v)) return { ok: false, field: at }
  const { kind, status, day, amountMinor, accountId } = v
  if (kind !== 'income' && kind !== 'expense' && kind !== 'transfer') return { ok: false, field: `${at}.kind` }
  if (status !== 'actual' && status !== 'planned') return { ok: false, field: `${at}.status` }
  if (!isDay(day)) return { ok: false, field: `${at}.day` }
  if (!isMinorAmount(amountMinor)) return { ok: false, field: `${at}.amountMinor` }
  if (!isId(accountId)) return { ok: false, field: `${at}.accountId` }
  const transfer = kind === 'transfer'

  let toAccountId: string | null = null
  let toAmountMinor: number | null = null
  if (transfer) {
    if (!isId(v.toAccountId) || v.toAccountId === accountId) return { ok: false, field: `${at}.toAccountId` }
    toAccountId = v.toAccountId
    if (v.toAmountMinor !== null) {
      if (!isMinorAmount(v.toAmountMinor)) return { ok: false, field: `${at}.toAmountMinor` }
      toAmountMinor = v.toAmountMinor
    }
  } else {
    if (v.toAccountId !== null) return { ok: false, field: `${at}.toAccountId` }
    if (v.toAmountMinor !== null) return { ok: false, field: `${at}.toAmountMinor` }
  }

  let categoryId: string | null = null
  let counterpartyId: string | null = null
  let accrual: BatchOp['accrual'] = null
  if (transfer) {
    if (v.categoryId !== null) return { ok: false, field: `${at}.categoryId` }
    if (v.counterpartyId !== null) return { ok: false, field: `${at}.counterpartyId` }
    if (v.accrual !== null) return { ok: false, field: `${at}.accrual` }
  } else {
    const category = nullableId(v.categoryId, `${at}.categoryId`)
    if (!category.ok) return category
    categoryId = category.value
    const counterparty = nullableId(v.counterpartyId, `${at}.counterpartyId`)
    if (!counterparty.ok) return counterparty
    counterpartyId = counterparty.value
    if (v.accrual !== null) {
      const a = v.accrual
      if (!isRecord(a) || !isDay(a.from) || !isDay(a.to)) return { ok: false, field: `${at}.accrual` }
      accrual = { from: a.from, to: a.to }
    }
  }

  if (!Array.isArray(v.tagIds) || v.tagIds.length > MAX_TX_TAGS || !v.tagIds.every(isId)) return { ok: false, field: `${at}.tagIds` }
  let description: string | null = null
  if (v.description !== null) {
    if (typeof v.description !== 'string' || v.description.length > DESCRIPTION_MAX) return { ok: false, field: `${at}.description` }
    description = v.description
  }
  const identity = identityOf(v.identity, `${at}.identity`)
  if (!identity.ok) return identity
  const ordinal = ordinalOf(v.ordinal, `${at}.ordinal`)
  if (!ordinal.ok) return ordinal

  return {
    ok: true,
    value: {
      kind,
      status,
      day,
      amountMinor,
      accountId,
      toAccountId,
      toAmountMinor,
      categoryId,
      counterpartyId,
      tagIds: [...(v.tagIds as string[])],
      description,
      accrual,
      identity: identity.value,
      ordinal: ordinal.value,
    },
  }
}

/** The batch body (S14b step 6): a Finmap import and at most 60 operations, each checked for its own shape. */
export function parseFinmapBatch(body: unknown): Parsed<FinmapBatchRequest> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (!isId(body.importId)) return { ok: false, field: 'importId' }
  if (!Array.isArray(body.operations) || body.operations.length > FINMAP_BATCH_OPS) return { ok: false, field: 'operations' }
  const operations: BatchOp[] = []
  for (let i = 0; i < body.operations.length; i++) {
    const r = parseBatchOp(body.operations[i], `operations[${i}]`)
    if (!r.ok) return r
    operations.push(r.value)
  }
  return { ok: true, value: { importId: body.importId, operations } }
}

/** The duplicate-check body (S14b): the keys of up to 500 operations, read-only. */
export function parseFinmapCheck(body: unknown): Parsed<FinmapCheckRequest> {
  if (!isRecord(body)) return { ok: false, field: 'body' }
  if (!Array.isArray(body.operations) || body.operations.length > CHECK_LIMIT) return { ok: false, field: 'operations' }
  const operations: FinmapCheckOp[] = []
  for (let i = 0; i < body.operations.length; i++) {
    const at = `operations[${i}]`
    const o = body.operations[i]
    if (!isRecord(o)) return { ok: false, field: at }
    if (!isId(o.accountId)) return { ok: false, field: `${at}.accountId` }
    const toAccountId = nullableId(o.toAccountId, `${at}.toAccountId`)
    if (!toAccountId.ok) return toAccountId
    const identity = identityOf(o.identity, `${at}.identity`)
    if (!identity.ok) return identity
    const ordinal = ordinalOf(o.ordinal, `${at}.ordinal`)
    if (!ordinal.ok) return ordinal
    operations.push({ accountId: o.accountId, toAccountId: toAccountId.value, identity: identity.value, ordinal: ordinal.value })
  }
  return { ok: true, value: { operations } }
}
