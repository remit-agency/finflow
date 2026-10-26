/** One published NBP table A: PLN per one unit of each currency (`mid`). */
export type NbpTable = {
  /** e.g. "208/A/NBP/2026" */
  no: string
  /** Publication day, YYYY-MM-DD. */
  effectiveDate: string
  rates: Record<string, number>
}

/** Cached `fxTables/{YYYY-MM}` document. */
export type MonthDoc = {
  month: string
  /** Ascending by effectiveDate. */
  tables: NbpTable[]
  /** Epoch ms of the NBP fetch. */
  fetchedAt: number
  /** True when the month had ended before the fetch: the document never changes again. */
  complete: boolean
}

/** What a caller stores next to an amount so the conversion can be reproduced. */
export type RateSnapshot = {
  rate: number
  from: string
  to: string
  requestedDate: string
  /** effectiveDate of the table used; equals requestedDate for identical currencies. */
  rateDate: string
  /** null for identical currencies. */
  tableNo: string | null
  source: 'NBP_A' | 'identity'
}

export type FxErrorCode = 'invalid_params' | 'unsupported_currency' | 'no_rate_before' | 'provider_unavailable'

export class FxError extends Error {
  public readonly code: FxErrorCode

  constructor(code: FxErrorCode) {
    super(code)
    this.name = 'FxError'
    this.code = code
  }
}
