import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The cookie page promises "two cookies, no analytics, no tracking". This guard keeps that true: a tracker or a new cookie
// writer has to be added here on purpose (and the cookie page updated) instead of slipping in unnoticed.
const ROOT = join(import.meta.dirname, '..', '..', '..')

const SCAN_DIRS = ['app', 'components', 'lib', 'content']
const SCAN_FILES = ['proxy.ts']
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/

// Any mention of an analytics or tracking product, in code or in a comment.
const TRACKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'firebase/analytics', pattern: /firebase\/analytics/ },
  { name: 'gtag(', pattern: /gtag\(/ },
  { name: 'googletagmanager', pattern: /googletagmanager/i },
  { name: '@vercel/analytics', pattern: /@vercel\/analytics/ },
  { name: '@vercel/speed-insights', pattern: /@vercel\/speed-insights/ },
  { name: 'posthog', pattern: /posthog/i },
  { name: 'hotjar', pattern: /hotjar/i },
]

// A way to set a cookie from the browser or to build a Set-Cookie header. Reading a cookie is not matched.
const COOKIE_WRITES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'document.cookie =', pattern: /document\.cookie\s*\+?=(?!=)/ },
  { name: 'Set-Cookie header', pattern: /set-cookie/i },
  { name: 'cookies().set / .cookies.set', pattern: /\bcookies\(\)\s*\.set\b|\.cookies\.set\b/ },
]

// File -> why it may write a cookie. These files hold the only cookies the cookie page lists:
// the `__session` login cookie and the language cookie.
const COOKIE_ALLOW: Record<string, string> = {
  'lib/server/session-cookie.ts': 'builds the Set-Cookie strings of the login session cookie and the language cookie',
  'lib/i18n/client.ts': 'writes the language cookie from the browser (a preference, not a secret)',
  'app/api/auth/session/route.ts': 'sends the session cookie built by session-cookie.ts after sign-in',
  'app/api/auth/logout/route.ts': 'sends the cleared session cookie built by session-cookie.ts at sign-out',
  'proxy.ts': 'clears a forged or expired session cookie with the header built by session-cookie.ts',
}

// Packages that must not be installed at all (the name is matched, not the import).
const FORBIDDEN_PACKAGE = /^@vercel\/(analytics|speed-insights)$|posthog|hotjar|googletagmanager|gtag/i

/** The rules a source file breaks. `path` is the repo-relative path with forward slashes. Pure. */
export function findViolations(path: string, source: string): string[] {
  const out: string[] = []
  for (const { name, pattern } of TRACKERS) {
    if (pattern.test(source)) out.push(`${path}: mentions ${name}`)
  }
  if (!(path in COOKIE_ALLOW)) {
    for (const { name, pattern } of COOKIE_WRITES) {
      if (pattern.test(source)) out.push(`${path}: writes a cookie (${name}) but is not in COOKIE_ALLOW`)
    }
  }
  return out
}

/** The installed packages (dependencies and devDependencies) whose name is a tracker. */
export function forbiddenPackages(manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string[] {
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].filter((n) => FORBIDDEN_PACKAGE.test(n))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (SOURCE.test(entry)) out.push(full)
  }
  return out
}

const rel = (full: string) => relative(ROOT, full).split(sep).join('/')

describe('no tracking', () => {
  const files = [...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))), ...SCAN_FILES.map((f) => join(ROOT, f))]

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.map(rel)).toContain('proxy.ts')
  })

  it('no source file mentions an analytics or tracking product, or writes a cookie outside the allow-list', () => {
    const violations = files.flatMap((f) => findViolations(rel(f), readFileSync(f, 'utf8')))
    expect(violations).toEqual([])
  })

  it('every allow-listed cookie file still exists and still writes a cookie (a stale entry hides nothing)', () => {
    for (const path of Object.keys(COOKIE_ALLOW)) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      expect(COOKIE_WRITES.some(({ pattern }) => pattern.test(source)), path).toBe(true)
    }
  })

  it('package.json lists no analytics or tracking package', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Parameters<typeof forbiddenPackages>[0]
    expect(forbiddenPackages(manifest)).toEqual([])
  })
})

describe('the scanner itself', () => {
  it.each([
    ["import { getAnalytics } from 'firebase/analytics'", 'firebase/analytics'],
    ["gtag('event', 'x')", 'gtag('],
    ['<script src="https://www.googletagmanager.com/gtm.js" />', 'googletagmanager'],
    ["import { Analytics } from '@vercel/analytics/next'", '@vercel/analytics'],
    ["import { SpeedInsights } from '@vercel/speed-insights/next'", '@vercel/speed-insights'],
    ["import posthog from 'posthog-js'", 'posthog'],
    ["window.hj = window.hj || function () {} // Hotjar", 'hotjar'],
  ])('flags a tracker: %s', (snippet, name) => {
    expect(findViolations('components/x.tsx', snippet)).toEqual([`components/x.tsx: mentions ${name}`])
  })

  it('flags a cookie write outside the allow-list and accepts the same code in an allowed file', () => {
    expect(findViolations('components/x.tsx', "document.cookie = 'a=1'")).toHaveLength(1)
    expect(findViolations('app/api/x/route.ts', "return new Response(null, { headers: { 'Set-Cookie': 'a=1' } })")).toHaveLength(1)
    expect(findViolations('components/x.tsx', 'res.cookies.set("a", "1")')).toHaveLength(1)
    expect(findViolations('lib/i18n/client.ts', "document.cookie = 'a=1'")).toEqual([])
  })

  it('does not flag reading a cookie or comparing document.cookie', () => {
    expect(findViolations('components/x.tsx', 'const all = document.cookie; if (document.cookie === "") return')).toEqual([])
  })

  it('flags a tracker package by name', () => {
    expect(forbiddenPackages({ dependencies: { next: '1', 'posthog-js': '1' }, devDependencies: { '@vercel/analytics': '1' } })).toEqual([
      'posthog-js',
      '@vercel/analytics',
    ])
    expect(forbiddenPackages({ dependencies: { next: '1', firebase: '1' } })).toEqual([])
  })
})
