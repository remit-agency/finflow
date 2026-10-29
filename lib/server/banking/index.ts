import 'server-only'
import { createJwt } from '@/lib/enablebanking/jwt'
import { ledgerDeps } from '@/lib/server/ledger'
import type { BankDeps } from './deps'
import { createEbApi, type Psu } from './eb-api'
import { disconnect, linkAccount, listConnectionAccounts, saveSession } from './link'
import { readBankStatus } from './status'
import { syncStep } from './sync'

/** The person at the other end of the request, so the bank counts the call as made with the user present. */
export function psuFromRequest(req: Request): Psu {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return { ip: forwarded || undefined, userAgent: req.headers.get('user-agent') || undefined }
}

export function bankDeps(req: Request): BankDeps {
  const ledger = ledgerDeps()
  return { db: ledger.db, ledger, now: ledger.now, today: ledger.today, eb: createEbApi({ token: createJwt, psu: psuFromRequest(req) }) }
}

export const banking = { saveSession, linkAccount, listConnectionAccounts, disconnect, syncStep, readStatus: readBankStatus }
