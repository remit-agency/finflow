// Argument parsing for scripts/erase-org.ts and scripts/erase-user.ts. Pure: unit-tested in Vitest.
// The messages never repeat the target: it can be an email.

export type EraseKind = 'org' | 'user'

export interface EraseArgs {
  /** The company id (org) or the uid or email (user), exactly as given. */
  target: string
  /** Only true together with `--confirm=<target>`; otherwise the run is a dry run. */
  apply: boolean
  /** Company only: erase without revoking the bank sessions. */
  skipBankRevoke: boolean
}

export type ParsedEraseArgs = { ok: true; args: EraseArgs } | { ok: false; message: string }

export function parseEraseArgs(kind: EraseKind, argv: readonly string[]): ParsedEraseArgs {
  const what = kind === 'org' ? 'a company id' : 'a uid or an email'
  let target: string | undefined
  let confirm: string | undefined
  let apply = false
  let skipBankRevoke = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg.startsWith('--confirm=')) confirm = arg.slice('--confirm='.length)
    else if (arg === '--skip-bank-revoke' && kind === 'org') skipBankRevoke = true
    else if (arg.startsWith('-')) return { ok: false, message: `Unknown argument ${arg.split('=')[0]}.` }
    else if (target !== undefined) return { ok: false, message: `Give exactly one target (${what}).` }
    else target = arg
  }
  if (target === undefined || target === '') return { ok: false, message: `Missing the target: ${what}.` }
  if (target.includes('/')) return { ok: false, message: `The target must be ${what}, without "/".` }
  if (confirm !== undefined && !apply) return { ok: false, message: '--confirm only goes with --apply.' }
  if (apply && confirm === undefined) return { ok: false, message: 'REFUSED: --apply needs --confirm=<the same target>. Nothing was changed.' }
  if (apply && confirm !== target) return { ok: false, message: 'REFUSED: --confirm does not match the target. Nothing was changed.' }
  return { ok: true, args: { target, apply, skipBankRevoke } }
}

/** The user an erase-user target names: an argument with "@" is an email, anything else a uid. */
export function userRef(target: string): { uid: string } | { email: string } {
  return target.includes('@') ? { email: target } : { uid: target }
}
