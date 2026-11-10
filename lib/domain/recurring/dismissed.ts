import { readDismissed, writeDismissed, type KeyValueStorage } from '@/lib/domain/transfers/dismissed'

/** Where this browser keeps the plan matches the person turned down (S11), per company. Never sent to the server. */
export const PLAN_DISMISSED_PREFIX = 'finflow:plan-dismissed:'

/** The turned-down matches (`matchKey`); [] when storage is missing, blocked, throws or holds something else. */
export function readPlanDismissed(storage: KeyValueStorage | null, orgId: string): string[] {
  return readDismissed(storage, orgId, PLAN_DISMISSED_PREFIX)
}

/** Keeps `keys` (the newest 500). False when storage is missing or refuses: the list then lives in memory only. */
export function writePlanDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[]): boolean {
  return writeDismissed(storage, orgId, keys, PLAN_DISMISSED_PREFIX)
}
