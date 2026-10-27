// Argument parsing for scripts/migrate-ledger-v2.ts. Pure: unit-tested in Vitest.

export interface LedgerCliArgs {
  apply: boolean
  dropLegacy: boolean
  /** Accounts that open at 0. */
  resetOpening: Set<string>
  /** Limit the run to one company. */
  org?: string
  /** Every argument as given, for the production flag check (`--project=...`, `--rules-deployed`). */
  raw: string[]
}

export type ParsedLedgerCliArgs = { ok: true; args: LedgerCliArgs } | { ok: false; message: string }

const PLAIN_FLAGS = new Set(['--apply', '--drop-legacy', '--rules-deployed'])

/** `--project=` takes any value here; assertProductionFlags decides whether it is the production project. */
export function parseLedgerCliArgs(argv: readonly string[]): ParsedLedgerCliArgs {
  const result: LedgerCliArgs = { apply: false, dropLegacy: false, resetOpening: new Set(), raw: [...argv] }
  for (const arg of argv) {
    if (arg === '--apply') result.apply = true
    else if (arg === '--drop-legacy') result.dropLegacy = true
    else if (arg.startsWith('--project=') || PLAIN_FLAGS.has(arg)) continue
    else if (arg.startsWith('--reset-opening=')) {
      const ids = arg.slice('--reset-opening='.length).split(',').map((s) => s.trim())
      if (ids.some((id) => id === '' || id.includes('/'))) return { ok: false, message: '--reset-opening needs account ids separated by commas.' }
      for (const id of ids) result.resetOpening.add(id)
    } else if (arg.startsWith('--org=')) {
      const org = arg.slice('--org='.length)
      if (org === '' || org.includes('/')) return { ok: false, message: '--org needs a company id.' }
      result.org = org
    } else {
      return { ok: false, message: `Unknown argument ${arg.split('=')[0]}.` }
    }
  }
  if (result.apply && result.dropLegacy) return { ok: false, message: 'Use --apply and --drop-legacy in separate runs.' }
  if (result.dropLegacy && result.resetOpening.size > 0) return { ok: false, message: '--reset-opening applies to --apply only.' }
  return { ok: true, args: result }
}
