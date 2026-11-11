// lib/server/reports/balances.ts
// The balances on a day (S12; the Balance page): the account documents and the shared balance at a day in one
// read-only snapshot, valued at NBP rates afterwards. Never cached longer than the request.
import { balanceRates, balancesReport } from '@/lib/domain/reports/balances'
import { ReportError } from '@/lib/domain/reports/errors'
import { REPORT_SCAN_CAP, type BalancesReport } from '@/lib/domain/reports/types'
import { balancesAt, countArrivals, type BalanceReadStats } from '@/lib/server/ledger/balance-at'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { readSnapshot } from '@/lib/server/ledger/reader'
import { quoteRates } from './rates'
import { readContext, type ReportReadStats } from './read'

/** Every account at the close of `date` (a later day is today). The arrival reads are counted against the cap before any read. */
export async function readBalances(deps: LedgerDeps, orgId: string, date: string, opts: { cap?: number } = {}): Promise<{ report: BalancesReport; stats: ReportReadStats }> {
  const today = deps.today()
  const day = date < today ? date : today
  const cap = opts.cap ?? REPORT_SCAN_CAP
  const read = await readSnapshot(deps.db, async (r) => {
    const context = await readContext(r, deps.db, orgId, false)
    const counted = await countArrivals(r, deps, orgId, context.accounts, [day], today)
    const arrivalReads = [...counted.values()].reduce((a, b) => a + b, 0)
    if (arrivalReads > cap) throw new ReportError('too_many_operations', { cap })
    const balanceStats: BalanceReadStats = { docsRead: 0, aggregates: 0, ids: new Set(), counted }
    const balances = await balancesAt(r, deps, orgId, context.accounts, [day], today, balanceStats)
    const stats: ReportReadStats = { operations: balanceStats.ids?.size ?? 0, rollups: 0, aggregates: balanceStats.aggregates + counted.size, reads: balanceStats.docsRead }
    return { context, balances, stats }
  })
  const base = read.context.baseCurrency
  const { book: rates } = await quoteRates(deps.resolveRate, base, balanceRates(read.context.accounts, day, base))
  const atDay = new Map(read.context.accounts.map((a) => [a.id, read.balances.get(a.id)?.get(day) ?? a.balanceMinor]))
  return { report: balancesReport({ date: day, baseCurrency: base, accounts: read.context.accounts, balances: atDay, rates }), stats: read.stats }
}
