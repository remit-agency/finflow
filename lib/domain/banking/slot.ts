import { addDays } from '@/lib/domain/ledger/days'

/** Warsaw hours at which a background refresh slot starts. A slot lasts until the next one starts. */
export const SLOT_STARTS = [8, 13, 17] as const

/**
 * The background refresh slot a Warsaw moment belongs to, as `YYYY-MM-DD#HH` (the day and hour the slot started).
 * 08:00-12:59 is `#08`, 13:00-16:59 is `#13`, and 17:00 up to 07:59 the next morning is `#17` of the day it started.
 * `day` is the Warsaw date (YYYY-MM-DD) and `hour` the Warsaw hour (0-23) of the same moment.
 */
export function backgroundSlot(day: string, hour: number): string {
  if (hour < SLOT_STARTS[0]) return `${addDays(day, -1)}#${String(SLOT_STARTS[2]).padStart(2, '0')}`
  const start = [...SLOT_STARTS].reverse().find((h) => hour >= h) ?? SLOT_STARTS[0]
  return `${day}#${String(start).padStart(2, '0')}`
}
