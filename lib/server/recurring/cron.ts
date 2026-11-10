import { addDays } from '@/lib/domain/ledger/days'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { CRON_MAX_SERIES, type RecurringCronSummary } from '@/lib/domain/recurring/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { fillSeries } from '@/lib/server/ledger/series'
import { dueSeriesQuery } from './read'

/** Refusals that pass by themselves (a rebuild holds the ledger, a write raced): try again at the next hourly call. */
const TRANSIENT = new Set(['ledger_busy', 'conflict'])

/**
 * The daily fill of planned payments (S11), a step of the hourly `POST /api/cron/bank-sync`. Reads the due series of every
 * company, longest waiting first (at most `max`), and fills each in its own transaction (`fillSeries`, which checks `dueOn`
 * again inside, so parallel calls never fill twice). The time budget is checked before each series: what is left waits for
 * the next call. A failing series never stops the others: it is logged by ids and counted; a lasting failure (no account,
 * an unreadable series) moves its `dueOn` to tomorrow, a passing one leaves it for the next hour. Counts only, never names.
 * Never throws: the dependencies are made inside (`deps` is a factory, so a missing setting is a failure too), and a failed
 * read of the due series is one failure.
 */
export async function runRecurringCron(deps: () => LedgerDeps, opts: { budgetMs: number; max?: number }): Promise<RecurringCronSummary> {
  const started = Date.now()
  const summary: RecurringCronSummary = { considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 }
  if (opts.budgetMs <= 0) return summary
  let ledger: LedgerDeps
  let today: string
  let docs
  try {
    ledger = deps()
    today = ledger.today()
    docs = (await dueSeriesQuery(ledger.db, today).select().limit(opts.max ?? CRON_MAX_SERIES).get()).docs
  } catch (e) {
    console.error('recurring cron: the due series could not be read', { error: e instanceof Error ? e.name : 'unknown' })
    summary.failed++
    return summary
  }
  summary.considered = docs.length
  for (const [i, doc] of docs.entries()) {
    if (Date.now() - started >= opts.budgetMs) {
      summary.skipped += docs.length - i
      break
    }
    const orgId = doc.ref.parent.parent?.id
    if (orgId === undefined) {
      summary.failed++
      continue
    }
    try {
      const r = await fillSeries(ledger, orgId, doc.id)
      if (r.due) {
        summary.filled++
        summary.created += r.created
      } else summary.skipped++
    } catch (e) {
      summary.failed++
      const code = e instanceof LedgerError || e instanceof RecurringError ? e.code : 'unknown'
      console.error('recurring cron: a series could not be filled', { orgId, seriesId: doc.id, code })
      if (!TRANSIENT.has(code)) {
        try {
          await doc.ref.update({ dueOn: addDays(today, 1) })
        } catch {
          // The next run tries the series again.
        }
      }
    }
  }
  return summary
}
