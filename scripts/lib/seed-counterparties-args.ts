// Argument parsing for scripts/seed-counterparties.ts. Pure: unit-tested in Vitest.

export interface SeedArgs {
  apply: boolean
  /** Limit the run to one company. */
  org?: string
  /** Every argument as given, for the production flag check (`--project=...`). */
  raw: string[]
}

export type ParsedSeedArgs = { ok: true; args: SeedArgs } | { ok: false; message: string }

export function parseSeedArgs(argv: readonly string[]): ParsedSeedArgs {
  const args: SeedArgs = { apply: false, org: undefined, raw: [...argv] }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg.startsWith('--project=')) continue
    else if (arg.startsWith('--org=')) {
      const org = arg.slice('--org='.length)
      if (org === '' || org.includes('/')) return { ok: false, message: '--org needs a company id.' }
      args.org = org
    } else return { ok: false, message: `Unknown argument ${arg.split('=')[0]}.` }
  }
  return { ok: true, args }
}
