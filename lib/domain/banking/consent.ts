import { fromDay } from '@/lib/domain/ledger/days'

/** The notice starts this many days before the access ends. */
export const NOTICE_DAYS = 3

export type ConsentNotice =
  | { kind: 'none' }
  | { kind: 'days'; days: 1 | 2 | 3 }
  | { kind: 'today' }
  | { kind: 'expired' }

/** Both arguments are Warsaw calendar days (`YYYY-MM-DD`): the last day of the access and today. */
export function consentNotice(validUntilDay: string, today: string): ConsentNotice {
  const left = Math.round((fromDay(validUntilDay).getTime() - fromDay(today).getTime()) / 86_400_000)
  if (left < 0) return { kind: 'expired' }
  if (left === 0) return { kind: 'today' }
  if (left <= NOTICE_DAYS) return { kind: 'days', days: left as 1 | 2 | 3 }
  return { kind: 'none' }
}
