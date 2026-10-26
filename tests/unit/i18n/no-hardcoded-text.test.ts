import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

// Directories scanned. The marketing pages (app/page.tsx, app/pricing, components/landing) are
// out of S03's scope (S17), so they are not scanned.
const SCAN = ['app/(app)', 'app/(auth)', 'components', 'lib', 'types']
const SKIP_PREFIXES = ['components/landing']
// File -> why it may keep Cyrillic or 'uk-UA'.
const ALLOW: Record<string, string> = {
  'lib/i18n/config.ts': 'the Ukrainian locale tag and its own-language label',
}

const SOURCE = /\.(ts|tsx)$/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (SOURCE.test(entry)) out.push(full)
  }
  return out
}

/**
 * Removes block and line comments so explanations in Ukrainian are allowed, and leaves string and
 * template literals untouched: a block-comment opener or a double slash inside one (a glob, a URL)
 * is text, not a comment, and must neither hide the rest of the file nor be dropped.
 */
function stripComments(source: string): string {
  let out = ''
  // One entry per open template literal: null while inside its text, otherwise the brace depth
  // inside its `${ }`.
  const templates: (number | null)[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    const top = templates.length ? templates[templates.length - 1] : undefined

    if (top === null) {
      // Template text.
      if (ch === '\\') {
        out += source.slice(i, i + 2)
        i += 2
      } else if (ch === '`') {
        templates.pop()
        out += ch
        i++
      } else if (ch === '$' && next === '{') {
        templates[templates.length - 1] = 0
        out += '${'
        i += 2
      } else {
        out += ch
        i++
      }
      continue
    }

    // Code: the top level, or inside a template's `${ }`.
    if (top !== undefined) {
      if (ch === '{') templates[templates.length - 1] = top + 1
      else if (ch === '}') templates[templates.length - 1] = top === 0 ? null : top - 1
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < source.length && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      out += source.slice(i, j + 1)
      i = j + 1
    } else if (ch === '`') {
      templates.push(null)
      out += ch
      i++
    } else {
      out += ch
      i++
    }
  }
  return out
}

const files = SCAN.flatMap((dir) => walk(join(ROOT, dir)))
  .map((file) => relative(ROOT, file).split(sep).join('/'))
  .filter((file) => !SKIP_PREFIXES.some((p) => file.startsWith(p)))

const stripped = (file: string) => stripComments(readFileSync(join(ROOT, file), 'utf8'))

// Attributes a screen reader or a tooltip shows. A literal here is text nobody can translate.
// Values with no letters at all (`0.00`, `—`, `∞`) are numbers or symbols, not words.
const ATTRIBUTE_LITERAL =
  /\b(placeholder|aria-label|title|alt)=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g
const HAS_WORD = /[A-Za-zА-Яа-яІіЇїЄєҐґ]/
// 'file:attribute="value"' -> why the word may stay. Empty today: every attribute goes through t().
const ATTRIBUTE_ALLOW: Record<string, string> = {}

function attributeWords(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(ATTRIBUTE_LITERAL)) {
    const value = match.slice(2).find((group) => group !== undefined) ?? ''
    if (HAS_WORD.test(value)) found.push(`${match[1]}="${value}"`)
  }
  return found
}

// Dates, numbers, money and case mapping go through lib/i18n (bound to the UI language) or lib/utils
// (pure helpers that take the language as a parameter), so both own the Intl calls. Anywhere else a
// formatter would pick the browser's or the server's language by itself.
const FORMATTING_OWNERS = ['lib/i18n/', 'lib/utils/']
// File -> why it may call Intl / toLocale*() itself. Empty today.
const INTL_ALLOW: Record<string, string> = {}

describe('no hard-coded UI text', () => {
  it('scans a sensible number of files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no Cyrillic text outside the message catalogs', () => {
    const offenders = files.filter((file) => {
      if (ALLOW[file]) return false
      return /[А-Яа-яІіЇїЄєҐґ]/.test(stripped(file))
    })
    expect(offenders).toEqual([])
  })

  it("no hard-coded 'uk-UA' / toLocaleDateString() / toLocaleString() in app code", () => {
    const offenders = files.filter((file) => {
      if (ALLOW[file]) return false
      return /uk-UA|\.toLocaleDateString\(|\.toLocaleString\(|\.toLocaleTimeString\(/.test(stripped(file))
    })
    expect(offenders).toEqual([])
  })

  it('no literal words in placeholder / aria-label / title / alt attributes', () => {
    const offenders = files.flatMap((file) =>
      attributeWords(stripped(file))
        .filter((found) => !ATTRIBUTE_ALLOW[`${file}:${found}`])
        .map((found) => `${file}: ${found}`),
    )
    expect(offenders).toEqual([])
  })

  it('no `new Intl.` or toLocale*() outside lib/i18n and lib/utils', () => {
    const offenders = files.filter((file) => {
      if (FORMATTING_OWNERS.some((prefix) => file.startsWith(prefix)) || INTL_ALLOW[file]) return false
      return /\bnew\s+Intl\.|\.toLocale[A-Za-z]*\(/.test(stripped(file))
    })
    expect(offenders).toEqual([])
  })
})

describe('the checks themselves', () => {
  it('stripComments keeps strings that look like comments and drops real comments', () => {
    const source = [
      "const glob = 'src/**/*.ts' // дозвіл",
      'const url = "https://example.com/a" /* коментар */',
      'const tpl = `/* ${a} // ${`${b}`} */` // кінець',
      "const after = 'Текст'",
    ].join('\n')
    const result = stripComments(source)
    expect(result).toContain("'src/**/*.ts'")
    expect(result).toContain('"https://example.com/a"')
    expect(result).toContain('`/* ${a} // ${`${b}`} */`')
    expect(result).toContain("const after = 'Текст'")
    expect(result).not.toContain('дозвіл')
    expect(result).not.toContain('коментар')
    expect(result).not.toContain('кінець')
  })

  it('a string holding a block-comment opener does not hide a later offender', () => {
    const result = stripComments('const a = "/*"\nconst b = <input placeholder="Search" />\n// */')
    expect(attributeWords(result)).toEqual(['placeholder="Search"'])
  })

  it('finds literal words in every attribute form and lets numbers and symbols through', () => {
    const found = attributeWords(
      [
        "<input placeholder=\"Search\" aria-label='Закрити' />",
        '<img alt={"Logo"} title={`Close`} />',
        '<input placeholder="0.00" /><input placeholder="—" /><input placeholder="∞" />',
        '<input placeholder={t("x")} aria-label={label} alt={inst.name} />',
      ].join('\n'),
    )
    expect(found).toEqual(['placeholder="Search"', 'aria-label="Закрити"', 'alt="Logo"', 'title="Close"'])
  })
})
