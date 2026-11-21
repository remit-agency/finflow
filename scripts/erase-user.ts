// GDPR erasure of a user (S15a). IRREVERSIBLE: deletes the user's memberships, `userConsents/{uid}` with its events and
// the Firebase Auth account, and removes any `email`/`name` field from the audit entries the user wrote. The audit
// entries themselves stay: the uid there is a pseudonym and they are the companies' history of changes.
//   npm run erase:user -- <uid|email>                                    DRY RUN (the default): prints what would change
//   npm run erase:user -- <uid|email> --apply --confirm=<uid|email>      erases; --confirm must repeat the argument
// Always do the dry run first. Only counts are printed (plus the ids of the companies that block the erase), never
// names, emails or document content.
// REFUSED while the user is the only owner of a company: erase that company first (npm run erase:org, BEFORE this
// script) or hand the ownership over, then run this again.
// Target: the Firestore and Auth emulators when FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are both set,
// otherwise production through FIREBASE_SERVICE_ACCOUNT (base64 service-account JSON, as the app uses).
// Exit code: 0 done (or dry run), 1 the erase failed, 2 refused (only owner, no such user, missing confirmation) or bad
// arguments.
import { parseEraseArgs, userRef } from './lib/erase-args'
import { EraseError, executeUserErase, planUserErase } from './lib/erase'
import { describeError, eraseTarget, realEraseDeps } from './lib/erase-deps'

async function main(): Promise<number> {
  const parsed = parseEraseArgs('user', process.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.message)
    return 2
  }
  const { target, apply } = parsed.args
  const ref = userRef(target)

  const where = eraseTarget()
  if (where === 'mixed') {
    console.error('REFUSED: set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST, or neither. Nothing was changed.')
    return 2
  }
  if (where === 'production' && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('No credentials: set FIREBASE_SERVICE_ACCOUNT (base64 of the service-account JSON). Nothing was changed.')
    return 2
  }
  console.log(`target: ${where === 'emulator' ? 'EMULATOR' : 'PRODUCTION'}`)
  const deps = realEraseDeps()

  try {
    const plan = await planUserErase(deps, ref)
    const roles = new Map<string, number>()
    for (const m of plan.memberships) roles.set(m.role, (roles.get(m.role) ?? 0) + 1)
    const byRole = [...roles].map(([role, n]) => `${role} ${n}`).join(', ')
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: memberships: ${plan.memberships.length}${byRole ? ` (${byRole})` : ''}`)
    console.log(`only owner of: ${plan.soleOwnerOf.length} company(ies)`)
    console.log(`consent documents: ${plan.consentDocs}; audit entries to scrub of email/name: ${plan.auditToScrub}; Auth account: deleted on --apply`)
    if (!apply) {
      if (plan.soleOwnerOf.length > 0) console.log(`The erase would be REFUSED: erase these companies first (npm run erase:org) or hand them over: ${plan.soleOwnerOf.join(', ')}`)
      console.log('Nothing was changed. To erase, repeat with --apply --confirm=<the same argument>.')
      return 0
    }
    const result = await executeUserErase(deps, ref)
    const c = result.counts
    console.log(`ERASED: memberships ${c.memberships}, consent documents ${c.consentDocs}, audit entries scrubbed ${c.auditScrubbed}, Auth account deleted. Logged in _meta/erasures/log.`)
    return 0
  } catch (e) {
    if (e instanceof EraseError && e.code === 'not_found') {
      console.error('NOT FOUND: there is no such user. Nothing was changed.')
      return 2
    }
    if (e instanceof EraseError && e.code === 'sole_owner') {
      const ids = Array.isArray(e.detail) ? e.detail : []
      console.error(`REFUSED: the user is the only owner of ${ids.length} company(ies): ${ids.join(', ')}. Erase them first (npm run erase:org) or hand them over. Nothing was changed.`)
      return 2
    }
    console.error(`FAILED (${describeError(e)}). Every step is idempotent: run the same command again to continue.`)
    return 1
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
