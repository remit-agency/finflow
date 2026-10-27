import { asRecord, bad, onlyKeys } from './guards'
import { MAX_MINOR, isMinor } from './money'
import { ACCOUNT_TYPES, LEDGER_CURRENCIES, type AccountType } from './types'

const ACCOUNT_KEYS = ['name', 'type', 'currency', 'color', 'openingMinor'] as const
const COLOR = /^#[0-9a-fA-F]{6}$/
const NAME_MAX = 120

export interface AccountInput {
  name: string
  type: AccountType
  currency: string
  color: string
  openingMinor: number
}

export type AccountPatch = Partial<AccountInput>

export interface OrgPatch {
  name?: string
  currency?: string
}

function name(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.trim()
  if (text.length < 1 || text.length > NAME_MAX) bad('name')
  return text
}

function pick(r: Record<string, unknown>, key: (typeof ACCOUNT_KEYS)[number]): unknown {
  switch (key) {
    case 'name':
      return name(r.name)
    case 'type':
      if (!(ACCOUNT_TYPES as readonly unknown[]).includes(r.type)) bad('type')
      return r.type
    case 'currency':
      if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(r.currency)) bad('currency')
      return r.currency
    case 'color':
      if (typeof r.color !== 'string' || !COLOR.test(r.color)) bad('color')
      return r.color
    case 'openingMinor':
      if (!isMinor(r.openingMinor) || Math.abs(r.openingMinor) > MAX_MINOR) bad('openingMinor')
      return r.openingMinor
  }
}

export function parseAccountInput(body: unknown): AccountInput {
  const r = asRecord(body)
  onlyKeys(r, ACCOUNT_KEYS)
  for (const key of ACCOUNT_KEYS) if (r[key] === undefined) bad(key)
  return Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, pick(r, key)])) as unknown as AccountInput
}

export function parseAccountPatch(body: unknown): AccountPatch {
  const r = asRecord(body)
  onlyKeys(r, ACCOUNT_KEYS)
  const keys = ACCOUNT_KEYS.filter((key) => r[key] !== undefined)
  if (keys.length === 0) bad('body')
  return Object.fromEntries(keys.map((key) => [key, pick(r, key)])) as AccountPatch
}

export function parseOrgPatch(body: unknown): OrgPatch {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'currency'])
  if (r.name === undefined && r.currency === undefined) bad('body')
  const out: OrgPatch = {}
  if (r.name !== undefined) out.name = name(r.name)
  if (r.currency !== undefined) {
    if (!(LEDGER_CURRENCIES as readonly unknown[]).includes(r.currency)) bad('currency')
    out.currency = r.currency as string
  }
  return out
}
