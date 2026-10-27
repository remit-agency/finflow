import { nameKey, nipKey } from './normalize'

/** The uniqueness key ids of a counterparty: the NIP key (if any) first, then the name key. */
export function keysOf(c: { name: string; nip?: string }): string[] {
  return c.nip === undefined ? [nameKey(c.name)] : [nipKey(c.nip), nameKey(c.name)]
}

/** Which input field a key id protects. */
export function keyField(key: string): 'nip' | 'name' {
  return key.startsWith('nip_') ? 'nip' : 'name'
}
