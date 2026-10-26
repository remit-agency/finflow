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

// Removes block and line comments (not the // of a URL) so explanations in Ukrainian are allowed.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '')
}

const files = SCAN.flatMap((dir) => walk(join(ROOT, dir)))
  .map((file) => relative(ROOT, file).split(sep).join('/'))
  .filter((file) => !SKIP_PREFIXES.some((p) => file.startsWith(p)))

describe('no hard-coded UI text', () => {
  it('scans a sensible number of files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no Cyrillic text outside the message catalogs', () => {
    const offenders = files.filter((file) => {
      if (ALLOW[file]) return false
      return /[А-Яа-яІіЇїЄєҐґ]/.test(stripComments(readFileSync(join(ROOT, file), 'utf8')))
    })
    expect(offenders).toEqual([])
  })

  it("no hard-coded 'uk-UA' / toLocaleDateString() / toLocaleString() in app code", () => {
    const offenders = files.filter((file) => {
      if (ALLOW[file]) return false
      return /uk-UA|\.toLocaleDateString\(|\.toLocaleString\(|\.toLocaleTimeString\(/.test(stripComments(readFileSync(join(ROOT, file), 'utf8')))
    })
    expect(offenders).toEqual([])
  })
})
