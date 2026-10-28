export interface RateLine {
  /** The currency of which one unit is worth more. */
  base: string
  quote: string
  /** How many `quote` one `base` is worth. */
  value: number
}

/**
 * The rate a transfer between two currencies implies, written the usual way (1 EUR = 4.4 PLN, not
 * 1 PLN = 0.2273 EUR). Null until both amounts are positive numbers.
 */
export function rateLine(spent: number, from: string, received: number, to: string): RateLine | null {
  if (!(spent > 0) || !(received > 0)) return null
  const ratio = received / spent
  return ratio >= 1 ? { base: from, quote: to, value: ratio } : { base: to, quote: from, value: spent / received }
}

/** An amount converted at a rate, for a hint (the server stores the real conversion). */
export function convertApprox(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100
}

export function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(rate)
}
