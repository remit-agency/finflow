export const VAT_STATUSES = ['active', 'exempt', 'unregistered'] as const
export type VatStatus = (typeof VAT_STATUSES)[number]

export const COUNTERPARTY_KINDS = ['zus', 'us'] as const
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number]

export const MAX_COUNTERPARTIES = 5000
export const MAX_IBANS = 20
export const ADDRESS_MAX = 300

export interface CounterpartyIban {
  /** Normalised NRB, 26 digits. */
  iban: string
  /** On the MF white list for this NIP (`null`: not checked). Set by the server. */
  onWhitelist: boolean | null
}

export interface Vat {
  status: VatStatus
  /** The day the white list was asked, `YYYY-MM-DD`. */
  checkedOn: string
}

export interface Counterparty {
  id: string
  name: string
  /** 10 digits, checksum valid. */
  nip?: string
  ibans: CounterpartyIban[]
  address?: string
  vat?: Vat
  /** Only the two system records. */
  kind?: CounterpartyKind
  archived: boolean
}
