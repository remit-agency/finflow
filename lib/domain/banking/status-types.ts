/** One account of a bank session, as the linking dialog lists it (owner only). */
export interface BankSessionAccount {
  uid: string
  iban: string | null
  currency: string | null
  name: string | null
  linked: boolean
}
