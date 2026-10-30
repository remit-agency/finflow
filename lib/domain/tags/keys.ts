import { nameKey } from '@/lib/domain/counterparties/normalize'

/**
 * Id of the uniqueness key document of a tag name (`tagKeys/name_…`): the counterparty name key, so case and Latin
 * diacritics do not count (`Łódź` = `lodz`) and Cyrillic letters keep their identity.
 */
export const tagNameKey = (name: string): string => nameKey(name)
