/** Cyrillic letters that look like Latin ones: the Finmap export mixes them into its header names. */
const LOOKALIKE: Record<string, string> = {
  'А': 'A', 'а': 'a', 'В': 'B', 'Е': 'E', 'е': 'e', 'К': 'K', 'к': 'k', 'М': 'M', 'Н': 'H', 'О': 'O', 'о': 'o',
  'Р': 'P', 'р': 'p', 'С': 'C', 'с': 'c', 'Т': 'T', 'Х': 'X', 'х': 'x', 'У': 'Y', 'у': 'y', 'І': 'I', 'і': 'i',
  'Ѕ': 'S', 'ѕ': 's', 'Ј': 'J', 'ј': 'j',
}

/** A header name as a comparison key: look-alikes to Latin, lower case, no diacritics, only letters and digits. */
export function foldHeader(s: string): string {
  let out = ''
  for (const ch of s) out += LOOKALIKE[ch] ?? ch
  return out.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '')
}

/** A name from a data cell: whitespace collapsed (including tabs and line breaks), trimmed; null when empty. */
export function normName(s: string | undefined | null): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** The key two names are compared by: `normName`, lower case. Not folded: a name in Cyrillic stays Cyrillic. */
export function normKey(s: string): string {
  return (normName(s) ?? '').toLowerCase()
}
