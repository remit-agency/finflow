// The real dependencies and the shared console helpers of scripts/erase-org.ts and scripts/erase-user.ts.
import { createJwt } from '@/lib/enablebanking/jwt'
import { createEbApi } from '@/lib/server/banking/eb-api'
import { getAdmin } from '@/lib/server/firebase-admin'
import { EraseError, type EraseDeps } from './erase'

/**
 * Where the Admin SDK would go. `mixed` (only one of the two emulator variables set) is refused: `getAdmin()` would
 * treat it as the emulator while the other service could reach a real project.
 */
export function eraseTarget(env: NodeJS.ProcessEnv = process.env): 'emulator' | 'production' | 'mixed' {
  const firestore = Boolean(env.FIRESTORE_EMULATOR_HOST)
  const auth = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST)
  if (firestore && auth) return 'emulator'
  if (firestore || auth) return 'mixed'
  return 'production'
}

function errorCode(e: unknown): unknown {
  return typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
}

/** Firestore through `getAdmin()`, Firebase Auth, and the Enable Banking client as the background sync builds it. */
export function realEraseDeps(): EraseDeps {
  const { db, auth } = getAdmin()
  const eb = createEbApi({ token: createJwt })
  return {
    db,
    now: () => new Date(),
    auth: {
      async getUserByEmail(email) {
        return { uid: (await auth.getUserByEmail(email)).uid }
      },
      async deleteUser(uid) {
        try {
          await auth.deleteUser(uid)
        } catch (e) {
          // Already deleted (a rerun after a failure at the last step): nothing left to do.
          if (errorCode(e) === 'auth/user-not-found') return
          throw e
        }
      },
    },
    revokeBankSession: (sessionId) => eb.deleteSession(sessionId),
  }
}

/** The error's code only: messages can quote what they were given (an email, a path with a uid). */
export function describeError(e: unknown): string {
  if (e instanceof EraseError) return e.code
  const code = errorCode(e)
  if (typeof code === 'string' || typeof code === 'number') return `code ${String(code)}`
  return e instanceof Error ? e.name : 'error'
}
