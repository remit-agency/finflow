import { foldDiacritics } from '@/lib/domain/text/fold'

/**
 * The comparable form of a text for the rules: Latin diacritics folded as in the counterparty name key, lower case,
 * every run of characters that are not letters or digits one space, trimmed. '' for a text with no letter or digit.
 */
export function normalizeRuleText(text: string): string {
  return foldDiacritics(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
