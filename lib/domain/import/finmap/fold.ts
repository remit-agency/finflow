/** Cyrillic letters that look like Latin ones: the Finmap export mixes them into its header names. */
const LOOKALIKE: Record<string, string> = {
  '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0415': 'E', '\u0435': 'e', '\u041a': 'K', '\u043a': 'k', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O', '\u043e': 'o',
  '\u0420': 'P', '\u0440': 'p', '\u0421': 'C', '\u0441': 'c', '\u0422': 'T', '\u0425': 'X', '\u0445': 'x', '\u0423': 'Y', '\u0443': 'y', '\u0406': 'I', '\u0456': 'i',
  '\u0405': 'S', '\u0455': 's', '\u0408': 'J', '\u0458': 'j',
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
