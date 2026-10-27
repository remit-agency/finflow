import { CounterpartyError } from './errors'
import { tryNormalizeIban } from './normalize'
import type { VatStatus } from './types'

export interface WhitelistSubject {
  name: string
  address?: string
  vatStatus: VatStatus
  /** Normalised NRBs; entries that are not valid account numbers are dropped. */
  ibans: string[]
}

export type WhitelistLookup = { found: false } | { found: true; subject: WhitelistSubject }

// A Map: a status text such as `constructor` must not find anything on an object prototype.
const STATUS = new Map<string, VatStatus>([
  ['Czynny', 'active'],
  ['Zwolniony', 'exempt'],
  ['Niezarejestrowany', 'unregistered'],
])

const unavailable = (): never => {
  throw new CounterpartyError('lookup_unavailable')
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/**
 * The body of `GET /api/search/nip/{nip}` of the MF white list API. A subject of `null` is an unknown NIP
 * (`found: false`). Anything that does not have the expected shape is `lookup_unavailable`: a reply we cannot
 * read must never be mistaken for "not found".
 */
export function parseWhitelistBody(body: unknown): WhitelistLookup {
  if (typeof body !== 'object' || body === null) return unavailable()
  const result = (body as Record<string, unknown>).result
  if (typeof result !== 'object' || result === null) return unavailable()
  const subject = (result as Record<string, unknown>).subject
  if (subject === null) return { found: false }
  if (typeof subject !== 'object' || subject === undefined) return unavailable()

  const s = subject as Record<string, unknown>
  const name = text(s.name)
  const vatStatus = typeof s.statusVat === 'string' ? STATUS.get(s.statusVat) : undefined
  if (name === undefined || vatStatus === undefined || !Array.isArray(s.accountNumbers)) return unavailable()

  const ibans = s.accountNumbers.map((n) => tryNormalizeIban(n)).filter((n): n is string => n !== null)
  const address = text(s.workingAddress) ?? text(s.residenceAddress)
  return { found: true, subject: { name, ...(address === undefined ? {} : { address }), vatStatus, ibans } }
}
