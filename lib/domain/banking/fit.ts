/** The opening balance that makes the FinFlow balance equal the bank's, given the operations already in. */
export function fittedOpening(bankMinor: number, balanceMinor: number, openingMinor: number): number {
  const net = balanceMinor - openingMinor
  return bankMinor - net
}

/** FinFlow balance minus the bank balance (0 when they agree). */
export function bankDifference(bankMinor: number, balanceMinor: number): number {
  return balanceMinor - bankMinor
}
