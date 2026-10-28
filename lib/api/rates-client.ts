export interface RateInfo {
  rate: number
  /** The day of the NBP table the rate comes from. */
  rateDate: string
}

/** The NBP rate for a hint in the form. Null when the server has none (an error status or an unusable body). */
export async function fetchRate(from: string, to: string, date: string, signal?: AbortSignal): Promise<RateInfo | null> {
  const query = new URLSearchParams({ from, to, date })
  const res = await fetch(`/api/rates?${query.toString()}`, { credentials: 'same-origin', signal })
  if (!res.ok) return null
  const body = (await res.json()) as { rate?: unknown; rateDate?: unknown }
  if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate <= 0) return null
  if (typeof body.rateDate !== 'string') return null
  return { rate: body.rate, rateDate: body.rateDate }
}
