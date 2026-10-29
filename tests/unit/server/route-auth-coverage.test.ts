import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_ROOT = join(import.meta.dirname, '..', '..', '..', 'app', 'api')

// Routes that authenticate some other way (or are deliberately public). Each needs a reason.
// This check is a best-effort smoke test (regex on source text, not an AST): auth performed in
// another file or helper is invisible to it, so such a route must be allow-listed with a reason.
const ALLOW_LIST: Record<string, string> = {
  'auth/session': 'verifies the freshly issued ID token itself and mints the session',
  'auth/logout': 'clears the session; must work with a missing or broken one',
  health: 'public liveness probe',
  'cron/bank-sync': 'authenticates with the BANK_CRON_SECRET bearer secret (lib/server/cron-auth), not a user session',
}

// Routes that read the Authorization header on purpose. Only the cron route, whose secret is the only way in.
const READS_AUTHORIZATION_BY_DESIGN: Record<string, string> = {
  'cron/bank-sync': 'compares the bearer secret in its own handler (bearerMatches)',
}

const ROUTE_FILE = /^route\.(ts|tsx|js|jsx)$/
const HANDLER_START = /export\s+(?:async\s+function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
const AUTH_CALL = /\bawait\s+require(Verified)?User\(/

interface RouteFile {
  key: string
  file: string
}

function routeFiles(dir: string): RouteFile[] {
  const found: RouteFile[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...routeFiles(full))
    else if (ROUTE_FILE.test(entry)) {
      found.push({ key: relative(API_ROOT, dir).replace(/\\/g, '/'), file: full })
    }
  }
  return found
}

// Best effort: drops block comments and line comments (not the "//" of a URL such as https://).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '')
}

// Returns the exported HTTP handlers whose body does not contain an awaited requireUser call.
function handlersMissingAuth(source: string): string[] {
  const stripped = stripComments(source)
  const starts = [...stripped.matchAll(HANDLER_START)]
  if (starts.length === 0) return ['(no exported handler found)']
  const missing: string[] = []
  starts.forEach((match, i) => {
    const segment = stripped.slice(match.index, starts[i + 1]?.index ?? stripped.length)
    if (!AUTH_CALL.test(segment)) missing.push(match[1])
  })
  return missing
}

describe('handlersMissingAuth', () => {
  it('reports a commented-out call', () => {
    const source = `export async function GET(req) {
  // await requireUser(req)
  /* await requireVerifiedUser(req) */
  return Response.json({})
}`
    expect(handlersMissingAuth(source)).toEqual(['GET'])
  })

  it('reports only the handler that does not authenticate', () => {
    const source = `export async function GET(req) {
  await requireUser(req)
  return Response.json({})
}
export async function POST(req) {
  return Response.json({})
}`
    expect(handlersMissingAuth(source)).toEqual(['POST'])
  })

  it('passes when every handler authenticates', () => {
    const source = `export async function GET(req) {
  await requireUser(req)
}
export async function POST(req) {
  await requireVerifiedUser(req)
}`
    expect(handlersMissingAuth(source)).toEqual([])
  })

  it('accepts the export const form', () => {
    const source = `export const GET = async () => { await requireUser(req) }`
    expect(handlersMissingAuth(source)).toEqual([])
  })

  it('reports a file without any recognisable handler', () => {
    expect(handlersMissingAuth(`export const dynamic = 'force-dynamic'`)).toEqual([
      '(no exported handler found)',
    ])
  })
})

describe('API route authentication coverage', () => {
  const routes = routeFiles(API_ROOT)
  const keys = routes.map((r) => r.key)
  const protectedRoutes = routes.filter((r) => !(r.key in ALLOW_LIST))

  it('finds the route files', () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  it.each(protectedRoutes.map((r) => [r.key, r.file] as const))(
    '%s authenticates in every handler',
    (_key, file) => {
      expect(handlersMissingAuth(readFileSync(file, 'utf8'))).toEqual([])
    },
  )

  it('does not keep allow-list entries for routes that no longer exist', () => {
    for (const key of Object.keys(ALLOW_LIST)) {
      expect(keys, `allow-listed route ${key} does not exist`).toContain(key)
    }
  })

  it('no route reads the incoming Authorization header', () => {
    for (const { key, file } of routes) {
      if (key in READS_AUTHORIZATION_BY_DESIGN) continue
      expect(readFileSync(file, 'utf8'), key).not.toMatch(/headers\.get\(\s*['"]authorization['"]\s*\)/i)
    }
  })
})
