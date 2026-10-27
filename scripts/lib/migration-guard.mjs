// Pure guards for scripts/migrate-memberships.mjs (S02): what a run against PRODUCTION must state
// explicitly before it may write. No I/O, no Firebase imports: unit-tested in Vitest.

export const PRODUCTION_PROJECT_FLAG = '--project=finflow-e94b5'
export const RULES_DEPLOYED_FLAG = '--rules-deployed'
export const ALLOW_SKIPPED_FLAG = '--allow-skipped'

/** Skipped reasons that mean "this member exists in the legacy map but gets no membership document". */
const DESTRUCTIVE_SKIP_REASONS = ['invalid_role', 'invalid_uid']

/**
 * Flag check that runs before anything is initialised or read.
 *
 * Emulator runs (`emulator: true`) are never restricted. A production DRY RUN needs no flag. A production
 * `--apply` or `--drop-members-map` needs `--project=finflow-e94b5`, and the drop also needs
 * `--rules-deployed` (the S02 app is deployed and the new firestore.rules are live: once the legacy
 * `members` field is gone, the OLD rules and the OLD app would lock every member out).
 *
 * `dropFlag` and `rulesStatement` only change the wording of the refusal, so another migration (the S05 ledger
 * migration: `--drop-legacy`) can reuse the same checks.
 *
 * @param {{ emulator: boolean, apply: boolean, drop: boolean, args: Iterable<string>, dropFlag?: string, rulesStatement?: string }} input
 * @returns {{ ok: true } | { ok: false, exitCode: 2, message: string }}
 */
export function assertProductionFlags({
  emulator,
  apply,
  drop,
  args,
  dropFlag = '--drop-members-map',
  rulesStatement = 'the S02 app is deployed and the new firestore rules are live (the old rules and the old app read the members field)',
}) {
  if (emulator || (!apply && !drop)) return { ok: true }
  const flags = new Set(args)
  const mode = drop ? dropFlag : '--apply'

  if (!flags.has(PRODUCTION_PROJECT_FLAG)) {
    return {
      ok: false,
      exitCode: 2,
      message: `REFUSED: ${mode} against PRODUCTION needs the explicit flag ${PRODUCTION_PROJECT_FLAG}. Nothing was read or written.`,
    }
  }
  if (drop && !flags.has(RULES_DEPLOYED_FLAG)) {
    return {
      ok: false,
      exitCode: 2,
      message:
        `REFUSED: ${dropFlag} against PRODUCTION also needs ${RULES_DEPLOYED_FLAG}, your statement that ${rulesStatement}. ` +
        'Nothing was read or written.',
    }
  }
  return { ok: true }
}

/**
 * Drop-only check that runs once the plan is known. Dropping the legacy `members` field erases the only record of
 * a member that planMemberships could not turn into a membership document (invalid role or uid), so it is refused
 * unless the operator passes `--allow-skipped`. Entries skipped for `no_members_map` are harmless.
 *
 * @param {{ args: Iterable<string>, skipped: Array<{ orgId: string, uid: string | null, reason: string }> }} input
 * @returns {{ ok: true } | { ok: false, exitCode: 1, message: string, ids: Array<{ orgId: string, uid: string | null, reason: string }> }}
 */
export function assertDropSkippedAllowed({ args, skipped }) {
  const ids = skipped.filter((s) => DESTRUCTIVE_SKIP_REASONS.includes(s.reason))
  if (ids.length === 0 || new Set(args).has(ALLOW_SKIPPED_FLAG)) return { ok: true }
  return {
    ok: false,
    exitCode: 1,
    message:
      `REFUSED: ${ids.length} legacy member(s) cannot become membership documents (invalid role or uid); dropping the members map ` +
      `would erase the only record of them. Fix or accept that, then re-run with ${ALLOW_SKIPPED_FLAG}.`,
    ids,
  }
}
