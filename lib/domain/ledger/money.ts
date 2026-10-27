import { roundAmount } from '@/lib/utils/amount-input'

/** Largest operation amount: 10^13 minor units (10^11 of the currency). */
export const MAX_MINOR = 10 ** 13

export function isMinor(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n)
}

/** An amount in the currency as the integer of its minor units (2 decimals, half away from zero). */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new RangeError('amount is not finite')
  // roundAmount makes the value an exact 2-decimal number; the multiplication can still land a hair
  // off an integer, which Math.round absorbs.
  return Math.round(roundAmount(major) * 100) || 0
}

export function fromMinor(minor: number): number {
  return minor / 100
}

/** `minor * rate` as an integer, half away from zero. */
export function mulRate(minor: number, rate: number): number {
  const scaled = Number((Math.abs(minor) * rate).toPrecision(15))
  const rounded = Math.round(scaled)
  return rounded === 0 ? 0 : minor < 0 ? -rounded : rounded
}
