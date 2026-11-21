// GDPR erasure of a whole company (S15a). IRREVERSIBLE: the company document and every subcollection (operations,
// accounts, members, bank connections, audit, locks, ...) are deleted for good. The members' Auth accounts stay.
//   npm run erase:org -- <orgId>                                   DRY RUN (the default): prints what would be deleted
//   npm run erase:org -- <orgId> --apply --confirm=<orgId>         erases; --confirm must repeat the company id
//   --skip-bank-revoke   erase even though the Enable Banking sessions cannot be revoked (the bank access stays
//                        granted until it expires or the customer withdraws it at the bank)
// Always do the dry run first. Only counts are printed, never names, emails or document content.
// The Enable Banking sessions are revoked before anything is deleted; if one cannot be, nothing is deleted.
// To erase a user who is the only owner of this company, run this erase FIRST, then npm run erase:user.
// Target: the Firestore and Auth emulators when FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are both set,
// otherwise production through FIREBASE_SERVICE_ACCOUNT (base64 service-account JSON, as the app uses). Revoking needs
// ENABLEBANKING_APP_ID and ENABLEBANKING_PRIVATE_KEY.
// Exit code: 0 done (or dry run), 1 the erase failed, 2 refused (no such company, missing confirmation) or bad arguments.
import { parseEraseArgs } from './lib/erase-args'
import { EraseError, executeOrgErase, planOrgErase } from './lib/erase'
import { describeError, eraseTarget, realEraseDeps } from './lib/erase-deps'

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

async function main(): Promise<number> {
  const parsed = parseEraseArgs('org', process.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.message)
    return 2
  }
  const { target, apply, skipBankRevoke } = parsed.args

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
    const plan = await planOrgErase(deps, target)
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: the company has ${sum(plan.collections)} document(s) in ${Object.keys(plan.collections).length} collection(s):`)
    for (const [name, count] of Object.entries(plan.collections)) console.log(`  ${name}: ${count}`)
    console.log(`members: ${plan.members} (their Auth accounts are not touched)`)
    console.log(`bank sessions to revoke: ${plan.bankSessions.length}; connections without a readable session id: ${plan.unreadableBankConnections}${skipBankRevoke ? ' (--skip-bank-revoke: NOT revoked)' : ''}`)
    if (!apply) {
      console.log('Nothing was changed. To erase, repeat with --apply --confirm=<the same company id>.')
      return 0
    }
    const result = await executeOrgErase(deps, target, { skipBankRevoke })
    console.log(`ERASED: ${sum(result.counts)} document(s) and the company document; bank sessions revoked: ${result.revoked}. Logged in _meta/erasures/log.`)
    return 0
  } catch (e) {
    if (e instanceof EraseError && e.code === 'not_found') {
      console.error('NOT FOUND: there is no such company. Nothing was changed.')
      return 2
    }
    if (e instanceof EraseError && e.code === 'bank_revoke_failed') {
      console.error(`FAILED: ${typeof e.detail === 'number' ? e.detail : '?'} bank session(s) could not be revoked (check ENABLEBANKING_APP_ID, ENABLEBANKING_PRIVATE_KEY and the bank's answer above). Nothing was deleted; rerun, or add --skip-bank-revoke to erase without revoking.`)
      return 1
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
