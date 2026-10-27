import { asRecord, bad, onlyKeys } from './guards'
import { cleanName, normalizeIban, normalizeNip } from './normalize'
import { ADDRESS_MAX, MAX_IBANS } from './types'

export interface CounterpartyInput {
  name: string
  nip?: string
  ibans: string[]
  address?: string
}

export interface CounterpartyPatch {
  name?: string
  /** `null` clears it. */
  nip?: string | null
  ibans?: string[]
  /** `null` clears it. */
  address?: string | null
  archived?: boolean
}

function address(v: unknown): string | undefined {
  if (typeof v !== 'string') bad('address')
  const text = v.trim()
  if (text.length > ADDRESS_MAX) bad('address')
  return text === '' ? undefined : text
}

function ibans(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_IBANS) bad('ibans')
  const out = v.map((x) => normalizeIban(x))
  if (new Set(out).size !== out.length) bad('ibans')
  return out
}

export function parseCounterpartyInput(body: unknown): CounterpartyInput {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'nip', 'ibans', 'address'])
  const out: CounterpartyInput = { name: cleanName(r.name), ibans: r.ibans === undefined ? [] : ibans(r.ibans) }
  if (r.nip !== undefined) out.nip = normalizeNip(r.nip)
  if (r.address !== undefined) {
    const a = address(r.address)
    if (a !== undefined) out.address = a
  }
  return out
}

export function parseCounterpartyPatch(body: unknown): CounterpartyPatch {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'nip', 'ibans', 'address', 'archived'])
  const out: CounterpartyPatch = {}
  if (r.name !== undefined) out.name = cleanName(r.name)
  if (r.nip !== undefined) out.nip = r.nip === null ? null : normalizeNip(r.nip)
  if (r.ibans !== undefined) out.ibans = ibans(r.ibans)
  if (r.address !== undefined) out.address = r.address === null ? null : (address(r.address) ?? null)
  if (r.archived !== undefined) {
    if (typeof r.archived !== 'boolean') bad('archived')
    out.archived = r.archived
  }
  if (Object.keys(out).length === 0) bad('body')
  return out
}
