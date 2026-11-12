import 'server-only'
import type { SeriesInput, SeriesPatch } from '@/lib/domain/recurring/input'
import type { FutureMode, MatchRequest, UpcomingPeriod } from '@/lib/domain/recurring/types'
import { ledger, ledgerDeps } from '@/lib/server/ledger'
import { runRecurringCron } from './cron'
import { readMatchSuggestions, readOverview, readSeries, readUpcoming } from './read'
import { runMatches } from './run'

/** Planned payments (S11) bound to the production Firestore and the Warsaw clock. Every write goes through `ledger`. */
export const recurring = {
  overview: (orgId: string) => readOverview(ledgerDeps(), orgId),
  upcoming: (orgId: string, period: UpcomingPeriod) => readUpcoming(ledgerDeps(), orgId, period),
  get: (orgId: string, seriesId: string) => readSeries(ledgerDeps(), orgId, seriesId),
  create: (orgId: string, uid: string, input: SeriesInput) => ledger.createSeries(orgId, uid, input),
  update: (orgId: string, uid: string, seriesId: string, patch: SeriesPatch) => ledger.updateSeries(orgId, uid, seriesId, patch),
  remove: (orgId: string, uid: string, seriesId: string, mode: FutureMode) => ledger.deleteSeries(orgId, uid, seriesId, mode),
  skip: (orgId: string, uid: string, seriesId: string, occurrence: string) => ledger.skipOccurrence(orgId, uid, seriesId, occurrence),
  /** What the journal offers: the pairs, how many there are, the ambiguous sides, whether a read was cut. */
  suggestions: async (orgId: string) => {
    const { pairs, total, ambiguous, truncated } = await readMatchSuggestions(ledgerDeps(), orgId)
    return { pairs, total, ambiguous, truncated }
  },
  matches: (orgId: string, uid: string, req: MatchRequest) => runMatches(ledger, orgId, uid, req),
  /** The daily fill, a step of the hourly cron call; never throws. */
  cron: (budgetMs: number) => runRecurringCron(() => ledgerDeps(), { budgetMs }),
}
