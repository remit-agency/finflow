import type { TransferSuggestion } from './types'

/** Where this browser keeps the suggested pairs the person turned down (S10b), per company. Never sent to the server. */
export const DISMISSED_PREFIX = 'finflow:transfer-dismissed:'
/** The newest turned-down pairs kept; older ones are forgotten (and may be suggested again). */
export const MAX_DISMISSED = 500

/** The part of `Storage` the list needs (`window.localStorage` fits). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export const pairKeyOf = (fromId: string, toId: string): string => `${fromId}|${toId}`
export const pairKey = (s: TransferSuggestion): string => pairKeyOf(s.from.id, s.to.id)

/** The pairs turned down in this browser; [] when storage is missing, blocked, throws or holds something else. */
export function readDismissed(storage: KeyValueStorage | null, orgId: string): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${DISMISSED_PREFIX}${orgId}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Keeps `keys` (the newest MAX_DISMISSED). False when storage is missing or refuses: the list then lives in memory only. */
export function writeDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(`${DISMISSED_PREFIX}${orgId}`, JSON.stringify(keys.slice(-MAX_DISMISSED)))
    return true
  } catch {
    return false
  }
}

/** `current` plus `added`, each key once, the newest last, at most MAX_DISMISSED. */
export function withDismissed(current: readonly string[], added: readonly string[]): string[] {
  const fresh = added.filter((k, i) => added.indexOf(k) === i)
  return [...current.filter((k) => !fresh.includes(k)), ...fresh].slice(-MAX_DISMISSED)
}
