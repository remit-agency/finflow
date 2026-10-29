import { foldDiacritics } from '@/lib/domain/text/fold'
import { bad } from './guards'

export const NAME_MAX = 200

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const

/** The display name: trimmed, inner whitespace collapsed. Refuses a name with no letters or digits (it has no key). */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > NAME_MAX) bad('name')
  if (nameKeyText(text) === '') bad('name')
  return text
}

/**
 * The comparable form of a name: Latin diacritics removed (`ł` counts as `l`), lower case, every run of
 * characters that are not letters or digits becomes one `_`. Other scripts keep their letters (only Latin
 * letters lose their marks, so Cyrillic `й` stays distinct from `и`; marks left over after recomposition, such
 * as a stress mark, are dropped).
 */
export function nameKeyText(name: string): string {
  return foldDiacritics(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ /g, '_')
}

/** Id of the uniqueness key document for a name. */
export const nameKey = (name: string): string => `name_${nameKeyText(name)}`

/** Id of the uniqueness key document for a (normalised) NIP. */
export const nipKey = (nip: string): string => `nip_${nip}`

function nipChecksumOk(d: string): boolean {
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * Number(d[i]), 0) % 11
  return sum === Number(d[9])
}

/** 10 digits with a valid checksum (`0000000000` passes it but is never a real NIP); accepts spaces, hyphens and a `PL` prefix. Throws `invalid_input` on `nip`. */
export function normalizeNip(v: unknown): string {
  if (typeof v !== 'string') bad('nip')
  const digits = v.replace(/[\s-]/g, '').replace(/^PL/i, '')
  if (!/^\d{10}$/.test(digits) || digits === '0000000000' || !nipChecksumOk(digits)) bad('nip')
  return digits
}

function nrbChecksumOk(nrb: string): boolean {
  // IBAN rule: move the country code and check digits to the end, letters become numbers (P=25, L=21).
  const rearranged = `${nrb.slice(2)}2521${nrb.slice(0, 2)}`
  let rest = 0
  for (const ch of rearranged) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

/** The Polish account number (NRB): 26 digits without spaces or the `PL` prefix, mod 97 checked. */
export function tryNormalizeIban(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const digits = v.replace(/[\s-]/g, '').replace(/^PL/i, '')
  return /^\d{26}$/.test(digits) && nrbChecksumOk(digits) ? digits : null
}

/** Throws `invalid_input` on `ibans` for anything that is not a valid Polish account number. */
export function normalizeIban(v: unknown): string {
  const nrb = tryNormalizeIban(v)
  if (nrb === null) bad('ibans')
  return nrb
}
