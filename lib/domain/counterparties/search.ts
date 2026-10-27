import { nameKeyText } from './normalize'
import type { Counterparty } from './types'

/**
 * The counterparties matching `query`, sorted by name. Every word of the query must occur in the name
 * (compared like the uniqueness key) or in the NIP (digits only). Archived ones are left out unless asked for.
 */
export function filterCounterparties(
  list: readonly Counterparty[],
  query: string,
  options: { includeArchived?: boolean } = {},
): Counterparty[] {
  const words = nameKeyText(query).split('_').filter(Boolean)
  const digits = query.replace(/[\s-]/g, '').replace(/^PL/i, '')

  return list
    .filter((c) => options.includeArchived === true || !c.archived)
    .filter((c) => {
      if (words.length === 0) return true
      const name = nameKeyText(c.name)
      if (words.every((w) => name.includes(w))) return true
      return c.nip !== undefined && /^\d+$/.test(digits) && c.nip.includes(digits)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
}
