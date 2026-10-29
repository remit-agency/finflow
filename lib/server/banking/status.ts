import 'server-only'
import type { BankAccountStatus, BankConnectionStatus, BankStatus } from '@/lib/domain/banking/status-types'
import type { Role } from '@/lib/shell/permissions'
import { todayDay } from '@/lib/utils/today'
import type { BankDeps } from './deps'
import { bankAccountsCol, bankConnectionsCol } from './paths'
import { parseBankAccount, parseConnection } from './types'

export async function readBankStatus(deps: BankDeps, orgId: string, role: Role): Promise<BankStatus> {
  const today = deps.today()
  const connections: BankConnectionStatus[] = []
  for (const d of (await bankConnectionsCol(deps.db, orgId).get()).docs) {
    const c = parseConnection(d.data())
    if (!c) continue
    const expired = c.status === 'expired' || todayDay(new Date(c.validUntil)) < today
    connections.push({
      id: d.id,
      institutionName: c.institutionName,
      institutionCountry: c.institutionCountry,
      psuType: c.psuType,
      status: expired ? 'expired' : 'active',
      validUntil: c.validUntil,
      connectedAt: c.connectedAt,
    })
  }
  connections.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt))
  if (role !== 'owner') return { connections }

  const accounts: BankAccountStatus[] = []
  for (const d of (await bankAccountsCol(deps.db, orgId).get()).docs) {
    const b = parseBankAccount(d.data())
    if (!b) continue
    accounts.push({
      id: d.id,
      connectionId: b.connectionId,
      ibanTail: b.iban === null ? null : b.iban.slice(-4),
      currency: b.currency,
      accountId: b.accountId,
      importFrom: b.importFrom,
      lastSyncAt: b.lastSyncAt,
      bankBalanceMinor: b.bankBalance?.amountMinor ?? null,
      status: b.status,
    })
  }
  return { connections, accounts }
}
