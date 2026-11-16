import 'server-only'
import { ledgerDeps } from '@/lib/server/ledger'
import { readCalendarDay, readCalendarMonth, readForecast } from './read'

/** The forecast and the payment calendar (S13) bound to the production Firestore, NBP rates and the Warsaw clock. Read only. */
export const forecast = {
  get: (orgId: string) => readForecast(ledgerDeps(), orgId),
  month: (orgId: string, year: number, month: number) => readCalendarMonth(ledgerDeps(), orgId, year, month),
  day: (orgId: string, date: string) => readCalendarDay(ledgerDeps(), orgId, date),
}
