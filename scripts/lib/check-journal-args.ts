// Argument parsing for scripts/check-journal-readiness.ts. Pure: unit-tested in Vitest.

export interface CheckJournalArgs {
  /** Limit the run to one company. */
  org?: string
  /** Every argument as given, for the production flag check (`--project=...`). */
  raw: string[]
}

export type ParsedCheckJournalArgs = { ok: true; args: CheckJournalArgs } | { ok: false; message: string }

export function parseCheckJournalArgs(argv: readonly string[]): ParsedCheckJournalArgs {
  const args: CheckJournalArgs = { org: undefined, raw: [...argv] }
  for (const arg of argv) {
    if (arg.startsWith('--project=')) continue
    if (arg.startsWith('--org=')) {
      const org = arg.slice('--org='.length)
      if (org === '' || org.includes('/')) return { ok: false, message: '--org needs a company id.' }
      args.org = org
    } else return { ok: false, message: `Unknown argument ${arg.split('=')[0]}.` }
  }
  return { ok: true, args }
}

/**
 * The script only reads, but a production run still has to be asked for by name: it runs paid queries over every
 * company. Emulator runs are never restricted.
 */
export function assertReadinessTarget(input: { emulator: boolean; args: readonly string[] }): { ok: true } | { ok: false; message: string } {
  if (input.emulator || input.args.includes('--project=finflow-e94b5')) return { ok: true }
  return {
    ok: false,
    message: 'REFUSED: running against PRODUCTION needs the explicit flag --project=finflow-e94b5. Nothing was read.',
  }
}
