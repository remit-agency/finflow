// lib/domain/reports/balance-sheet.ts
// The arithmetic of the Balance sheet (the Balance page, S12f). Pure: the component passes the account lines (each with
// its value in the company currency, `base`, in major units, null when it has no rate) and the manual fields.
// Each account is counted once: crypto accounts in section I (fixed assets), the others in section III (money).
// Extracted from components/charts/BalanceSheet.tsx.

/** One account line: `base` is its value in the company currency, null when it has no rate (counts as 0). */
export interface BalanceSheetAsset {
  type: string
  base: number | null
}

/** The manual figures typed on the page (major units of the company currency). */
export interface BalanceSheetFields {
  // Assets I — Fixed
  realestate: number
  equipment: number
  // Assets II — Current
  inventory: number
  receivables: number
  // Liabilities I — Equity
  charter_capital: number
  additional_capital: number
  // Liabilities II — Debt
  loans: number
}

export interface BalanceSheetTotals {
  cryptoTotal: number
  fixedTotal: number
  currentTotal: number
  moneyTotal: number
  totalAssets: number
  retainedEarnings: number
  equityTotal: number
  debtTotal: number
  totalLiabilities: number
  /** totalAssets - totalLiabilities; the page shows the check as balanced when its absolute value is below 0.01. */
  difference: number
}

export function balanceSheetTotals(lines: ReadonlyArray<BalanceSheetAsset>, fields: BalanceSheetFields): BalanceSheetTotals {
  // --- Assets calculations ---
  const cryptoTotal = lines.filter((a) => a.type === 'crypto').reduce((s, a) => s + (a.base ?? 0), 0)

  // Section I — Fixed assets
  const fixedTotal = fields.realestate + fields.equipment + cryptoTotal

  // Section II — Current assets
  const currentTotal = fields.inventory + fields.receivables

  // Section III — Money (auto from accounts): the non-crypto accounts only, as they are listed there.
  const moneyTotal = lines.filter((a) => a.type !== 'crypto').reduce((s, a) => s + (a.base ?? 0), 0)

  const totalAssets = fixedTotal + currentTotal + moneyTotal

  // --- Liabilities calculations ---
  // Section I — Equity
  // Retained earnings are the sum of ALL accounts, crypto included, so the equation balances. Worked example: a PLN
  // company with bank 1 000 and crypto 500, manual fields zero. Assets = fixed 500 (crypto) + money 1 000 = 1 500.
  // Retained earnings = 1 000 + 500 = 1 500, so liabilities = 1 500 and the difference is 0. Generally the retained
  // earnings cancel out of the difference, which is manual assets minus manual liabilities and equity.
  const retainedEarnings = lines.reduce((s, a) => s + (a.base ?? 0), 0)
  const equityTotal = fields.charter_capital + fields.additional_capital + retainedEarnings

  // Section II — Debt
  const debtTotal = fields.loans

  const totalLiabilities = equityTotal + debtTotal

  return {
    cryptoTotal,
    fixedTotal,
    currentTotal,
    moneyTotal,
    totalAssets,
    retainedEarnings,
    equityTotal,
    debtTotal,
    totalLiabilities,
    difference: totalAssets - totalLiabilities,
  }
}
