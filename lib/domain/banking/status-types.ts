export interface BankConnectionStatus {
  id: string
  institutionName: string
  institutionCountry: string | null
  psuType: 'business' | 'personal' | null
  status: 'active' | 'expired'
  validUntil: string
  connectedAt: string
}

export interface BankAccountStatus {
  id: string
  connectionId: string
  ibanTail: string | null
  currency: string
  accountId: string
  importFrom: string
  lastSyncAt: string | null
  bankBalanceMinor: number | null
  status: 'active' | 'disconnected'
}

export interface BankStatus {
  connections: BankConnectionStatus[]
  /** Owner only. */
  accounts?: BankAccountStatus[]
}

/** One account of a bank session, as the linking dialog lists it (owner only). */
export interface BankSessionAccount {
  uid: string
  iban: string | null
  currency: string | null
  name: string | null
  linked: boolean
}
