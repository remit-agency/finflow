// Regression guard: server-side CommonJS dependencies must load with require(esm) DISABLED.
//
// Vercel's Node 24 runtime crashed every route importing `firebase-admin/auth` with
// ERR_REQUIRE_ESM: firebase-admin -> jwks-rsa require()s `jose` ^6, which is ESM-only. Local Node 24 and
// CI both enable require(esm) by default, so it passed everywhere except production. This script loads
// each module in a child process started with `--no-experimental-require-module`, which reproduces the
// runtime's behaviour. The fix is the `overrides` entry for jwks-rsa -> jose ^5 in package.json.
//
// Add a specifier to SERVER_CJS_MODULES whenever a new CommonJS server dependency is imported by app code.
// Do NOT add ESM-only packages that we import ourselves (e.g. `jose`): Next.js bundles/externalizes those.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FLAG = '--no-experimental-require-module'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SERVER_CJS_MODULES = [
  'firebase-admin/app',
  'firebase-admin/auth',
  'firebase-admin/firestore',
  'stripe',
  'write-excel-file/node',
]

function runNode(args) {
  return spawnSync(process.execPath, [FLAG, ...args], { cwd: root, encoding: 'utf8' })
}

function fail(message) {
  console.error(`check-server-imports: FAILED\n${message}`)
  process.exit(1)
}

// 1. The flag must exist and must really disable require(esm); otherwise this guard would pass vacuously.
const dir = mkdtempSync(join(tmpdir(), 'check-server-imports-'))
try {
  writeFileSync(join(dir, 'esm-only.mjs'), 'export const x = 1\n')
  const probe = runNode(['-e', `require(${JSON.stringify(join(dir, 'esm-only.mjs'))})`])
  if (!/ERR_REQUIRE_ESM/.test(probe.stderr ?? '')) {
    fail(
      `Node ${process.version} does not honour ${FLAG} (require(esm) was not rejected), so this guard cannot ` +
        `detect ERR_REQUIRE_ESM.\n${probe.stderr ?? ''}`,
    )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// 2. Every server module must load through require() with require(esm) disabled.
const failures = []
for (const specifier of SERVER_CJS_MODULES) {
  const result = runNode(['-e', `require(${JSON.stringify(specifier)})`])
  if (result.status === 0) {
    console.log(`ok   require('${specifier}')`)
    continue
  }
  const stderr = (result.stderr ?? '').trim()
  const detail = stderr.split('\n').find((l) => /ERR_|Error/.test(l)) ?? stderr.split('\n')[0] ?? ''
  console.log(`FAIL require('${specifier}')`)
  failures.push(`- ${specifier}: ${detail}`)
}

if (failures.length > 0) {
  fail(
    `${failures.length} server module(s) cannot be require()d when require(esm) is disabled, which is how the ` +
      `Vercel runtime behaved (ERR_REQUIRE_ESM):\n${failures.join('\n')}\n\n` +
      `Likely cause: a CommonJS dependency now require()s an ESM-only package (e.g. jwks-rsa -> jose ^6). ` +
      `Run \`npm ls <package>\` to find it and pin a CJS-compatible version via "overrides" in package.json.`,
  )
}
console.log(`check-server-imports: all ${SERVER_CJS_MODULES.length} modules load with ${FLAG}`)
