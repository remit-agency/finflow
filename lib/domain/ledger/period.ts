import { monthsBetween, overlapDays } from './days'

/**
 * Splits `total` over the calendar months of [from, to] in proportion to the days of each month
 * inside the range. Every month but the last gets floor(|total| * days / allDays); the last gets
 * the rest, so the parts always add up to `total` exactly. BigInt keeps the product exact.
 */
export function allocatePeriod(total: number, from: string, to: string): Array<[string, number]> {
  const months = monthsBetween(from, to)
  const days = months.map((m) => overlapDays(m, from, to))
  const allDays = days.reduce((a, b) => a + b, 0)
  const abs = Math.abs(total)
  const sign = total < 0 ? -1 : 1
  let used = 0
  return months.map((month, i): [string, number] => {
    const part =
      i === months.length - 1 ? abs - used : Number((BigInt(abs) * BigInt(days[i])) / BigInt(allDays))
    used += part
    return [month, part === 0 ? 0 : sign * part]
  })
}
