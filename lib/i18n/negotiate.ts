import { DEFAULT_LOCALE, isLocale, type Locale } from './config'

interface Candidate {
  tag: string
  q: number
}

// "pl-PL,pl;q=0.9,en;q=0.8" -> [{pl, 1}, {pl, 0.9}, {en, 0.8}] ordered by q (stable for equal q).
function parseAcceptLanguage(header: string): Candidate[] {
  const candidates: Candidate[] = []
  for (const part of header.split(',')) {
    const [rawTag, ...params] = part.trim().split(';')
    const tag = rawTag.trim().toLowerCase()
    if (!tag || tag === '*') continue
    let q = 1
    for (const param of params) {
      const [name, value] = param.trim().split('=')
      if (name?.trim().toLowerCase() === 'q') q = Number(value)
    }
    if (!Number.isFinite(q) || q <= 0) continue
    candidates.push({ tag: tag.split('-')[0], q })
  }
  return candidates.map((c, index) => ({ c, index })).sort((a, b) => b.c.q - a.c.q || a.index - b.index).map(({ c }) => c)
}

/** A valid cookie wins; otherwise the best supported browser language; otherwise Polish. */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie
  for (const { tag } of parseAcceptLanguage(input.acceptLanguage ?? '')) {
    if (isLocale(tag)) return tag
  }
  return DEFAULT_LOCALE
}
