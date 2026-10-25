import { describe, expect, it } from 'vitest'
import uk from '@/messages/uk.json'
import pl from '@/messages/pl.json'
import en from '@/messages/en.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

// Argument names of an ICU message: `{name}`, `{count, plural, ...}` -> name, count.
// (`{# dzień}` inside a plural branch has no identifier, so it is not an argument.)
function icuArguments(message: string): string[] {
  const names = new Set<string>()
  for (const match of message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,|\})/g)) names.add(match[1])
  return [...names].sort()
}

const catalogs = { uk: flatten(uk as Tree), pl: flatten(pl as Tree), en: flatten(en as Tree) }
const keys = Object.keys(catalogs.uk).sort()

describe('message catalogs', () => {
  it('have at least one key', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  it.each(['pl', 'en'] as const)('%s has exactly the keys of uk', (locale) => {
    expect(Object.keys(catalogs[locale]).sort()).toEqual(keys)
  })

  it.each(['uk', 'pl', 'en'] as const)('%s has no empty values', (locale) => {
    for (const [key, value] of Object.entries(catalogs[locale])) {
      expect(value.trim(), `${locale}:${key}`).not.toBe('')
    }
  })

  it.each(['pl', 'en'] as const)('%s uses the same ICU arguments as uk in every message', (locale) => {
    for (const key of keys) {
      expect(icuArguments(catalogs[locale][key]), `${locale}:${key}`).toEqual(icuArguments(catalogs.uk[key]))
    }
  })

  it('pl and en have no Cyrillic text', () => {
    for (const locale of ['pl', 'en'] as const) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        expect(/[А-Яа-яІіЇїЄєҐґ]/.test(value), `${locale}:${key}`).toBe(false)
      }
    }
  })
})
