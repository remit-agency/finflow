import { COUNTERPARTY_KINDS, VAT_STATUSES, type Counterparty, type CounterpartyIban, type CounterpartyKind, type Vat, type VatStatus } from './types'

export const SCHEMA_VERSION = 1

/** The Firestore fields of a counterparty (no timestamps, no orgId: the writer adds those). */
export function counterpartyToDoc(c: Counterparty): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    name: c.name,
    ibans: c.ibans.map((i) => ({ iban: i.iban, onWhitelist: i.onWhitelist })),
    archived: c.archived,
  }
  if (c.nip !== undefined) doc.nip = c.nip
  if (c.address !== undefined) doc.address = c.address
  if (c.vat !== undefined) doc.vat = { status: c.vat.status, checkedOn: c.vat.checkedOn }
  if (c.kind !== undefined) doc.kind = c.kind
  return doc
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseIbans(v: unknown): CounterpartyIban[] | null {
  if (!Array.isArray(v)) return null
  const out: CounterpartyIban[] = []
  for (const item of v) {
    const r = record(item)
    if (!r || typeof r.iban !== 'string' || !(r.onWhitelist === null || typeof r.onWhitelist === 'boolean')) return null
    out.push({ iban: r.iban, onWhitelist: r.onWhitelist })
  }
  return out
}

function parseVat(v: unknown): Vat | null {
  const r = record(v)
  if (!r || typeof r.checkedOn !== 'string' || !(VAT_STATUSES as readonly unknown[]).includes(r.status)) return null
  return { status: r.status as VatStatus, checkedOn: r.checkedOn }
}

/** Strict reader: `null` for a document that is not a schema 1 counterparty. */
export function parseCounterparty(id: string, data: unknown): Counterparty | null {
  const r = record(data)
  if (!r || r.schemaVersion !== SCHEMA_VERSION) return null
  if (typeof r.name !== 'string' || r.name === '' || typeof r.archived !== 'boolean') return null
  const ibans = parseIbans(r.ibans)
  if (ibans === null) return null

  const c: Counterparty = { id, name: r.name, ibans, archived: r.archived }
  if (r.nip !== undefined) {
    if (typeof r.nip !== 'string') return null
    c.nip = r.nip
  }
  if (r.address !== undefined) {
    if (typeof r.address !== 'string') return null
    c.address = r.address
  }
  if (r.vat !== undefined) {
    const vat = parseVat(r.vat)
    if (vat === null) return null
    c.vat = vat
  }
  if (r.kind !== undefined) {
    if (!(COUNTERPARTY_KINDS as readonly unknown[]).includes(r.kind)) return null
    c.kind = r.kind as CounterpartyKind
  }
  return c
}
